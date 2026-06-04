/**
 * QuantumClaw — Tool Executor
 *
 * The agentic loop: LLM calls tools → we execute → feed results back → repeat.
 *
 * Supports:
 *   - Single tool calls
 *   - Parallel tool calls (multiple in one response)
 *   - Sequential chains (tool result triggers another tool call)
 *   - Max iterations guard (prevents infinite loops)
 *   - Approval system for dangerous tools (shell, file write)
 *
 * Works with both Anthropic and OpenAI-compatible tool calling APIs.
 */

import { log } from '../core/logger.js';
import { appendCacheUsage, toolsHash } from '../observability/cache-usage-log.js';

const MAX_TOOL_ITERATIONS = 100;  // Safety limit — increased for AGEX security implementation
const TOOL_TIMEOUT = 30000;      // 30s per tool call
const LONG_RUNNING_TOOL_TIMEOUT = 11 * 60 * 1000;  // 11 min — covers 10-min approval gate + buffer

const OWNER_TELEGRAM_CHAT_ID = 1375806243;
const CREDITS_NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let _lastCreditsNotifyAt = 0;

// ─── Slice 3f: prompt-cache plumbing ───────────────────────────────────────
// Process-local flags. _cacheControlRejected is set true on the first 400 we
// detect with a cache_control error pattern; persists until process restart.
// _cacheControlRejectionMessage captures the API error text for observability.
// _ephemeralExtractionWarned guards a one-time warn when usage.cache_creation
// reports >0 tokens but neither ephemeral path returns a value.
//
// See /tmp/slice3f_design.md §8.1 (fail-open) and §7.2 (extraction fallback).
let _cacheControlRejected = false;
let _cacheControlRejectionMessage = null;
let _ephemeralExtractionWarned = false;

// Test-only reset helper. Production callers never invoke this.
export function __resetSlice3fStateForTests() {
  _cacheControlRejected = false;
  _cacheControlRejectionMessage = null;
  _ephemeralExtractionWarned = false;
}

// Test-only setter — simulates the post-rejection state without needing to
// mock a full Anthropic 400 round-trip. Production code never calls this.
export function __setSlice3fRejectedForTests(rejected, message = null) {
  _cacheControlRejected = !!rejected;
  _cacheControlRejectionMessage = rejected ? (message || 'test-injected rejection') : null;
}

// Read-side observer for tests + consistency checks. Returns the per-request
// cache-decision contract derived from kill-switch env + module-local flag.
export function _slice3fComputeCacheStrategy() {
  const envEnabled = _isPromptCacheEnabledLive();
  return {
    envEnabled,
    rejected: _cacheControlRejected,
    rejectionMessage: _cacheControlRejectionMessage,
    shouldEmitCacheControl: envEnabled && !_cacheControlRejected,
  };
}

// Test-only export of the placement validator + dynamic-heading list. Used
// by tests/system-prompt-cache-shape.test.js to exercise the invariant
// directly without standing up a full executor + fetch mock.
export const _slice3fInternal = {
  validateCacheControlPlacement: null, // assigned below once defined
  dynamicHeadings: null,                // assigned below once defined
};

// Mirrors registry.js::isPromptCacheEnabled — read here as defence-in-depth
// so a kill-switch flip between caller and API call still scrubs cache_control.
function _isPromptCacheEnabledLive() {
  const v = process.env.QCLAW_PROMPT_CACHE_ENABLED;
  if (v == null) return true;
  const s = String(v).trim().toLowerCase();
  return !(s === '0' || s === 'false' || s === 'no' || s === 'off');
}

// Canonical dynamic-block heading prefixes — these MUST stay in lockstep with
// the headings emitted by registry.js::_buildSystemPrompt's dynamic section.
// See /tmp/slice3f_design.md §10 Unit 1 — heading-drift CI guard test.
const _SLICE3F_DYNAMIC_HEADINGS = [
  '\n## What I Know About You',       // knowledge.js:222 (knowledgeContext)
  '\n## Available Skills (routed)',   // registry.js:645  (on-demand skills)
  '\n## Relevant Context',            // registry.js:654  (relevant knowledge)
  '\n## Knowledge Graph',             // registry.js:662  (graph context)
];

// Validate cache_control placement on a system blocks array:
//   - exactly one block carries cache_control (drop extras defensively)
//   - that block's index is < first dynamic block's index
//   - kill-switch overrides — strip cache_control entirely if disabled
// Returns {blocks, cacheControlEmitted, invariantFailed}.
function _validateCacheControlPlacement(blocks, cacheEnabled) {
  let firstDynamicIdx = blocks.length;
  for (let i = 0; i < blocks.length; i++) {
    const text = blocks[i]?.text;
    if (typeof text === 'string') {
      for (const h of _SLICE3F_DYNAMIC_HEADINGS) {
        if (text.startsWith(h)) { firstDynamicIdx = i; break; }
      }
      if (firstDynamicIdx === i) break;
    }
  }

  const markedIdxs = blocks
    .map((b, i) => (b && b.cache_control ? i : -1))
    .filter(i => i >= 0);

  // Kill-switch path: strip every cache_control field.
  if (!cacheEnabled) {
    const stripped = blocks.map(b => {
      if (b && b.cache_control) {
        const { cache_control: _drop, ...rest } = b;
        return rest;
      }
      return b;
    });
    return { blocks: stripped, cacheControlEmitted: false, invariantFailed: false };
  }

  if (markedIdxs.length === 0) {
    return { blocks, cacheControlEmitted: false, invariantFailed: false };
  }
  if (markedIdxs.length > 1 || markedIdxs[0] >= firstDynamicIdx) {
    // Invariant violation — strip every marker and fail-open (no caching).
    log.warn(`[slice3f] cache_marker_misplaced: markedIdxs=${JSON.stringify(markedIdxs)} firstDynamicIdx=${firstDynamicIdx} — stripping cache_control`);
    const stripped = blocks.map(b => {
      if (b && b.cache_control) {
        const { cache_control: _drop, ...rest } = b;
        return rest;
      }
      return b;
    });
    return { blocks: stripped, cacheControlEmitted: false, invariantFailed: true };
  }
  return { blocks, cacheControlEmitted: true, invariantFailed: false };
}

// Wire test-only exports now that the function and constant are defined.
_slice3fInternal.validateCacheControlPlacement = _validateCacheControlPlacement;
_slice3fInternal.dynamicHeadings = _SLICE3F_DYNAMIC_HEADINGS;

export function isAnthropicCreditsError(err) {
  return err?.code === 'ANTHROPIC_CREDITS_EXHAUSTED';
}

// Best-effort Telegram DM to the owner when Anthropic credits run out.
// Rate-limited to one ping per cooldown window per process. Never throws.
export async function notifyAnthropicCreditsExhausted() {
  const now = Date.now();
  if (now - _lastCreditsNotifyAt < CREDITS_NOTIFY_COOLDOWN_MS) return;
  _lastCreditsNotifyAt = now;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: OWNER_TELEGRAM_CHAT_ID,
        text: '⚠️ Charlie offline — Anthropic credits exhausted. Top up at console.anthropic.com to restore.',
      }),
    });
  } catch {
    // Notification is best-effort — swallow to avoid cascading failures.
  }
}

export class ToolExecutor {
  constructor(router, toolRegistry, options = {}) {
    this.router = router;
    this.tools = toolRegistry;
    this.maxIterations = options.maxIterations || MAX_TOOL_ITERATIONS;
    this.requireApproval = options.requireApproval || [];
    this.onToolCall = options.onToolCall || null;   // callback for UI updates
    this.onToolResult = options.onToolResult || null;
    
    // AGEX Security Stack
    this.approvalGate = options.approvalGate || null;
    this.rateLimiter = options.rateLimiter || null;
    this.contentQueue = options.contentQueue || null;
    this.spikeDetector = options.spikeDetector || null;
    this.auditLog = options.auditLog || null;
  }

  /**
   * Run a full agentic completion with tool use.
   *
   * @param {Array} messages - Chat messages [{role, content}]
   * @param {Object} options - { model, system, maxTokens }
   * @returns {Object} { content, toolCalls, usage }
   */
  async run(messages, options = {}) {
    const model = options.model || this.router.primary;
    if (!model || !model.provider) {
      const result = await this.router.complete(messages, options);
      return { content: result.content, toolCalls: [], usage: result.usage, model: result.model };
    }
    const provider = model.provider;
    const toolDefs = this.tools.getToolDefinitions(provider === 'anthropic' ? 'anthropic' : 'openai');

    // If no tools available, just do a normal completion
    if (toolDefs.length === 0) {
      const result = await this.router.complete(messages, options);
      return { content: result.content, toolCalls: [], usage: result.usage, model: result.model };
    }

    let iteration = 0;
    let allToolCalls = [];
    let currentMessages = [...messages];
    let totalUsage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    };

    while (iteration < this.maxIterations) {
      iteration++;

      // Call LLM with tools. Slice 3f: thread tool_loop_iteration into options
      // so the per-call observability layer (Unit 2 cache-usage.log writer)
      // can tag iteration ≥ 2 entries — the system prefix is cached but the
      // growing messages tail is not (design §3.1.2).
      const result = await this._completionWithTools(currentMessages, toolDefs, model, { ...options, toolLoopIteration: iteration });
      totalUsage.input_tokens += result.usage?.input_tokens || 0;
      totalUsage.output_tokens += result.usage?.output_tokens || 0;
      totalUsage.cache_creation_input_tokens += result.usage?.cache_creation_input_tokens || 0;
      totalUsage.cache_read_input_tokens += result.usage?.cache_read_input_tokens || 0;
      totalUsage.ephemeral_5m_input_tokens += result.usage?.ephemeral_5m_input_tokens || 0;
      totalUsage.ephemeral_1h_input_tokens += result.usage?.ephemeral_1h_input_tokens || 0;

      // No tool use — we have the final text response
      if (!result.toolCalls || result.toolCalls.length === 0) {
        return {
          content: result.content,
          toolCalls: allToolCalls,
          usage: totalUsage,
          model: result.model,
          iterations: iteration,
        };
      }

      // Execute tool calls
      const toolResults = [];
      for (const call of result.toolCalls) {
        allToolCalls.push(call);

        if (this.onToolCall) {
          this.onToolCall(call);
        }

        try {
          log.debug(`Tool: ${call.name}(${JSON.stringify(call.args).slice(0, 100)})`);

          // AGEX: Check approval gate
          if (this.approvalGate) {
            const gateCheck = await this.approvalGate.check(call.name, call.args);
            if (gateCheck.requiresApproval) {
              log.warn(`🚨 Approval required: ${gateCheck.reason}`);
              const approval = await this.approvalGate.requestApproval(
                options.agent || 'unknown',
                call.name,
                call.args,
                gateCheck.riskLevel
              );
              
              if (!approval.approved) {
                throw new Error(`Action denied: ${approval.reason || 'No approval granted'}`);
              }
              log.success(`✅ Approved [${approval.id}]`);
            }
          }

          // AGEX: Check rate limits
          if (this.rateLimiter) {
            const category = this._categorizeToolCall(call.name, call.args);
            if (category) {
              const rateCheck = this.rateLimiter.check(category);
              if (!rateCheck.allowed) {
                throw new Error(`Rate limit exceeded: ${rateCheck.reason}`);
              }
            }
          }

          // AGEX: Content queue intercept
          if (this.contentQueue && this._isPublishingAction(call.name)) {
            const queueId = this.contentQueue.add(
              this._extractContentData(call.name, call.args),
              options.agent || 'unknown'
            );
            const queueResult = `Content queued for review [ID: ${queueId}]. Use content-queue approve ${queueId} to publish.`;
            toolResults.push({ id: call.id, name: call.name, result: queueResult, error: false });
            
            if (this.onToolResult) {
              this.onToolResult({ ...call, result: queueResult, ok: true });
            }
            continue; // Skip actual execution
          }

          // Tools that may wait on inline Telegram approval declare
          // `longRunning: true` on their builtin definition. For those we use
          // an 11-minute ceiling so the 10-min approval timeout can fire first.
          const toolDef = this.tools._builtins?.get(call.name);
          const toolTimeoutMs = toolDef?.longRunning ? LONG_RUNNING_TOOL_TIMEOUT : TOOL_TIMEOUT;
          const toolResult = await Promise.race([
            this.tools.executeTool(call.name, call.args),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Tool timeout')), toolTimeoutMs))
          ]);

          // AGEX: Consume rate limit after success
          if (this.rateLimiter) {
            const category = this._categorizeToolCall(call.name, call.args);
            if (category) {
              this.rateLimiter.consume(category);
            }
          }

          const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
          toolResults.push({ id: call.id, name: call.name, result: resultStr, error: false });

          if (this.onToolResult) {
            this.onToolResult({ ...call, result: resultStr, ok: true });
          }

        } catch (err) {
          const errorMsg = `Error executing ${call.name}: ${err.message}`;
          toolResults.push({ id: call.id, name: call.name, result: errorMsg, error: true });
          log.warn(errorMsg);
          // Slice 4: record the failed outcome so completion/state gates can
          // tell "claimed done" from "tool actually errored".
          if (this.onToolResult) {
            this.onToolResult({ ...call, result: errorMsg, ok: false });
          }
        }
      }

      // Append assistant message with tool calls + tool results to history
      if (provider === 'anthropic') {
        currentMessages = this._appendAnthropicToolLoop(currentMessages, result, toolResults);
      } else {
        currentMessages = this._appendOpenAIToolLoop(currentMessages, result, toolResults);
      }
    }

    // Hit max iterations — return what we have
    log.warn(`Tool loop hit max iterations (${this.maxIterations})`);
    return {
      content: 'I made several tool calls but hit the iteration limit. Here\'s what I found so far.',
      toolCalls: allToolCalls,
      usage: totalUsage,
      iterations: iteration,
    };
  }

  // ─── Provider-specific completion with tools ─────────────

  async _completionWithTools(messages, toolDefs, model, options) {
    const provider = model.provider;

    let apiKey = await this.router.secrets.get(`${provider}_api_key`);
    if (!apiKey) apiKey = model.apiKey;

    if (provider === 'anthropic') {
      return this._anthropicWithTools(apiKey, model.model, messages, toolDefs, options);
    } else {
      return this._openaiWithTools(provider, apiKey, model.model, messages, toolDefs, options);
    }
  }

  async _anthropicWithTools(apiKey, model, messages, tools, options) {
    // Slice 3f: handle structured `system` content. Messages with array
    // content (the new shape from registry.js _processNonReflex) are
    // forwarded to the API verbatim. String content remains supported for
    // legacy callers and the OpenAI-shaped path.
    const systemArrayParts = [];   // content blocks (Slice 3f)
    const systemStringParts = [];  // legacy string parts
    const chatMessages = [];

    for (const m of messages) {
      if (m.role === 'system') {
        if (Array.isArray(m.content)) {
          systemArrayParts.push(...m.content);
        } else if (typeof m.content === 'string') {
          systemStringParts.push(m.content);
        } else {
          systemStringParts.push(JSON.stringify(m.content));
        }
      } else {
        chatMessages.push(m);
      }
    }

    // options.system can be either a string (legacy) or an array of blocks
    // (Slice 3f registry.js path). Merge into the right channel without
    // double-counting.
    if (options.system) {
      if (Array.isArray(options.system)) {
        if (systemArrayParts.length === 0) {
          systemArrayParts.push(...options.system);
        }
      } else if (typeof options.system === 'string' && !systemStringParts.includes(options.system)) {
        systemStringParts.unshift(options.system);
      }
    }

    // Merge consecutive same-role messages (Anthropic requirement)
    const merged = [];
    for (const msg of chatMessages) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role
          && typeof msg.content === 'string' && typeof merged[merged.length - 1].content === 'string') {
        merged[merged.length - 1].content += '\n\n' + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }

    if (merged.length === 0 || merged[0].role !== 'user') {
      merged.unshift({ role: 'user', content: '(continuing)' });
    }

    // Slice 3f: prefer the structured array shape when present. Defence-in-
    // depth: re-check kill-switch here so a kill-switch flip between the
    // caller's check and the API call still scrubs cache_control. Also
    // enforce the runtime invariant — cache_control MUST land before the
    // first dynamic block (matched against canonical heading prefixes).
    //
    // Circuit-breaker: when a prior call in this process was rejected by
    // Anthropic for cache_control reasons (_cacheControlRejected), pretend
    // the kill-switch is off so the placement validator strips cache_control
    // upfront. Avoids paying a wasted 400 + fail-open retry on every
    // subsequent turn until process restart.
    let systemForApi;
    let runtimeCacheControlEmitted = false;
    let runtimeInvariantFailed = false;
    if (systemArrayParts.length > 0) {
      const cacheStillEnabled = _isPromptCacheEnabledLive() && !_cacheControlRejected;
      const validated = _validateCacheControlPlacement(systemArrayParts, cacheStillEnabled);
      systemForApi = validated.blocks;
      runtimeCacheControlEmitted = validated.cacheControlEmitted;
      runtimeInvariantFailed = validated.invariantFailed;
    } else if (systemStringParts.length > 0) {
      systemForApi = systemStringParts.join('\n\n');
    }

    const body = {
      model,
      max_tokens: options.maxTokens || 4096,
      messages: merged,
      tools,
    };
    if (systemForApi != null) body.system = systemForApi;

    const apiCall = async (bodyToSend) => fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(bodyToSend),
    });

    let res = await apiCall(body);
    let failOpenTriggered = false;
    let failOpenReason = null;

    // Slice 3f §8.1: fail-open on 400 with cache_control error pattern.
    // Strip cache_control from every system block and retry once. Subsequent
    // calls in this process record cache_control_emitted: false via the
    // shared cache-usage-log writer (Unit 2 wires this in).
    if (!res.ok && res.status === 400 && Array.isArray(body.system)) {
      const errText = await res.text();
      let parsed = null;
      try { parsed = JSON.parse(errText); } catch { /* not JSON */ }
      const apiErrMsg = parsed?.error?.message || errText;
      if (/cache_control/i.test(apiErrMsg) || /cache.*ephemeral/i.test(apiErrMsg)) {
        if (!_cacheControlRejected) {
          _cacheControlRejected = true;
          _cacheControlRejectionMessage = apiErrMsg.slice(0, 500);
          log.warn(`[slice3f] cache_control rejected by Anthropic — failing open. message: ${_cacheControlRejectionMessage}`);
        }
        const strippedSystem = body.system.map(b => {
          if (b && typeof b === 'object' && 'cache_control' in b) {
            const { cache_control: _drop, ...rest } = b;
            return rest;
          }
          return b;
        });
        const retryBody = { ...body, system: strippedSystem };
        res = await apiCall(retryBody);
        failOpenTriggered = true;
        failOpenReason = apiErrMsg.slice(0, 200);
      } else {
        // not a cache_control 400 — restore error text for the general handler
        res = { ok: false, status: 400, text: async () => errText };
      }
    }

    if (!res.ok) {
      const errText = typeof res.text === 'function' ? await res.text() : '';
      if (res.status === 400) {
        let parsed = null;
        try { parsed = JSON.parse(errText); } catch { /* not JSON */ }
        const apiErr = parsed?.error;
        if (apiErr?.type === 'invalid_request_error' && /credit balance/i.test(apiErr.message || '')) {
          log.warn('Anthropic credits exhausted — notifying owner, skipping call');
          await notifyAnthropicCreditsExhausted();
          const credErr = new Error('Anthropic credits exhausted');
          credErr.code = 'ANTHROPIC_CREDITS_EXHAUSTED';
          throw credErr;
        }
      }
      throw new Error(`Anthropic ${res.status}: ${errText}`);
    }

    const data = await res.json();

    // Parse response — can be mix of text and tool_use blocks
    let textContent = '';
    const toolCalls = [];

    for (const block of data.content || []) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: block.input || {},
        });
      }
    }

    // Slice 3f: capture all four cache-related usage fields with explicit
    // nested-then-top-level fallback for ephemeral_*_input_tokens (the
    // canonical Anthropic shape is nested under usage.cache_creation, but
    // some deployments observe top-level — see /tmp/slice3f_design.md §7.2).
    const u = data.usage || {};
    const ephemeral5m = u.cache_creation?.ephemeral_5m_input_tokens ?? u.ephemeral_5m_input_tokens ?? 0;
    const ephemeral1h = u.cache_creation?.ephemeral_1h_input_tokens ?? u.ephemeral_1h_input_tokens ?? 0;
    const cacheCreation = u.cache_creation_input_tokens || 0;
    const ephemeralExtractionFailed = (cacheCreation > 0 && ephemeral5m === 0 && ephemeral1h === 0
        && u.cache_creation?.ephemeral_5m_input_tokens === undefined
        && u.ephemeral_5m_input_tokens === undefined);
    if (ephemeralExtractionFailed && !_ephemeralExtractionWarned) {
      _ephemeralExtractionWarned = true;
      log.warn(`[slice3f] cache_creation_input_tokens > 0 but ephemeral_*_input_tokens absent at both paths. usage keys: ${Object.keys(u).join(', ')}`);
    }

    // Slice 3f Unit 2: emit one cache-usage.log entry per API round-trip.
    // Per /tmp/slice3f_design.md §7.3 — appendFileSync is write+close (not
    // fsync), bounded by the per-agent lock in registry.js so in-process
    // rotation races are bounded. Writer swallows its own errors; never
    // blocks the hot path.
    appendCacheUsage({
      model: data.model || model,
      channel: options.channel,
      userId: options.userId,
      input_tokens: u.input_tokens || 0,
      output_tokens: u.output_tokens || 0,
      cache_creation_input_tokens: cacheCreation,
      cache_read_input_tokens: u.cache_read_input_tokens || 0,
      ephemeral_5m_input_tokens: ephemeral5m,
      ephemeral_1h_input_tokens: ephemeral1h,
      ephemeral_extraction_failed: ephemeralExtractionFailed,
      bootstrap_cache_hit: !!options.bootstrapCacheHit,
      bootstrap_present: options.bootstrapPresent !== false,
      cache_control_emitted: runtimeCacheControlEmitted && !failOpenTriggered,
      tools,
      had_on_demand_skills: !!options.hadOnDemandSkills,
      tool_loop_iteration: options.toolLoopIteration || 1,
      runtime_invariant_failed: runtimeInvariantFailed,
      fail_open_triggered: failOpenTriggered,
      fail_open_reason: failOpenReason,
      cache_control_rejection_message: _cacheControlRejectionMessage,
    });

    return {
      content: textContent,
      toolCalls,
      stopReason: data.stop_reason,
      rawContent: data.content, // needed for appending to message history
      usage: {
        input_tokens: u.input_tokens || 0,
        output_tokens: u.output_tokens || 0,
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: u.cache_read_input_tokens || 0,
        ephemeral_5m_input_tokens: ephemeral5m,
        ephemeral_1h_input_tokens: ephemeral1h,
        ephemeral_extraction_failed: ephemeralExtractionFailed,
      },
      slice3f: {
        cache_control_emitted: runtimeCacheControlEmitted && !failOpenTriggered,
        runtime_invariant_failed: runtimeInvariantFailed,
        fail_open_triggered: failOpenTriggered,
        fail_open_reason: failOpenReason,
        cache_control_rejection_message: _cacheControlRejectionMessage,
      },
      model,
    };
  }

  async _openaiWithTools(provider, apiKey, model, messages, tools, options) {
    const endpoints = {
      openai: 'https://api.openai.com/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      together: 'https://api.together.xyz/v1/chat/completions',
      mistral: 'https://api.mistral.ai/v1/chat/completions',
      xai: 'https://api.x.ai/v1/chat/completions',
      google: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    };

    const url = endpoints[provider] || `${this.router.config.models?.customEndpoint}/v1/chat/completions`;

    const body = {
      model,
      messages,
      max_tokens: options.maxTokens || 4096,
      tools,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${provider} ${res.status}: ${err}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];

    const toolCalls = (choice?.message?.tool_calls || []).map(tc => ({
      id: tc.id,
      name: tc.function?.name,
      args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
    }));

    return {
      content: choice?.message?.content || '',
      toolCalls,
      stopReason: choice?.finish_reason,
      rawMessage: choice?.message, // needed for appending to history
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0,
      },
      model,
    };
  }

  // ─── Message history management for tool loops ──────────

  _appendAnthropicToolLoop(messages, assistantResult, toolResults) {
    // Append assistant response (with tool_use blocks)
    const newMessages = [...messages, {
      role: 'assistant',
      content: assistantResult.rawContent,
    }];

    // Append tool results
    const toolResultContent = toolResults.map(tr => ({
      type: 'tool_result',
      tool_use_id: tr.id,
      content: tr.result,
      is_error: tr.error,
    }));

    newMessages.push({
      role: 'user',
      content: toolResultContent,
    });

    return newMessages;
  }

  _appendOpenAIToolLoop(messages, assistantResult, toolResults) {
    // Append assistant message with tool calls
    const newMessages = [...messages, assistantResult.rawMessage];

    // Append each tool result
    for (const tr of toolResults) {
      newMessages.push({
        role: 'tool',
        tool_call_id: tr.id,
        content: tr.result,
      });
    }

    return newMessages;
  }

  // ─── AGEX Helper Methods ─────────────────────────────────

  _categorizeToolCall(toolName, toolArgs) {
    if (toolName.includes('social') || toolName.includes('twitter') || toolName.includes('linkedin') || toolName.includes('facebook')) {
      return 'social_posts';
    }
    if (toolName.includes('email') || toolName.includes('send')) {
      return 'emails';
    }
    if (toolName.startsWith('filesystem__write') || toolName.startsWith('filesystem__edit') || toolName.startsWith('filesystem__move')) {
      return 'file_changes';
    }
    if (toolName === 'shell_exec') {
      return 'shell_commands';
    }
    if (toolName.includes('stripe') || toolName.includes('ghl') || toolName.includes('n8n')) {
      return 'api_calls';
    }
    return null;
  }

  _isPublishingAction(toolName) {
    if (toolName.includes('wordpress') || toolName.includes('social') || toolName.includes('youtube')) {
      return true; // Always queue these
    }
    return false;
  }

  _extractContentData(toolName, toolArgs) {
    // Extract structured content data for queue
    const data = {
      type: 'unknown',
      platform: 'unknown',
      title: '',
      body: '',
      metadata: { toolName, originalArgs: toolArgs },
    };

    if (toolName.includes('wordpress')) {
      data.type = 'blog_post';
      data.platform = 'wordpress';
      data.title = toolArgs.title || toolArgs.post_title || '';
      data.body = toolArgs.content || toolArgs.post_content || '';
    } else if (toolName.includes('twitter') || toolName.includes('social')) {
      data.type = 'social_post';
      data.platform = toolArgs.platform || 'twitter';
      data.body = toolArgs.text || toolArgs.content || toolArgs.message || '';
    } else if (toolName.includes('youtube')) {
      data.type = 'youtube_metadata';
      data.platform = 'youtube';
      data.title = toolArgs.title || '';
      data.body = toolArgs.description || '';
    }

    return data;
  }
}
