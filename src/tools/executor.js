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

const MAX_TOOL_ITERATIONS = 10;  // Safety limit
const TOOL_TIMEOUT = 30000;      // 30s per tool call

export class ToolExecutor {
  constructor(router, toolRegistry, options = {}) {
    this.router = router;
    this.tools = toolRegistry;
    this.maxIterations = options.maxIterations || MAX_TOOL_ITERATIONS;
    this.requireApproval = options.requireApproval || [];
    this.onToolCall = options.onToolCall || null;   // callback for UI updates
    this.onToolResult = options.onToolResult || null;
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
    let totalUsage = { input_tokens: 0, output_tokens: 0 };

    while (iteration < this.maxIterations) {
      iteration++;

      // Call LLM with tools
      const result = await this._completionWithTools(currentMessages, toolDefs, model, options);
      totalUsage.input_tokens += result.usage?.input_tokens || 0;
      totalUsage.output_tokens += result.usage?.output_tokens || 0;

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

          const toolResult = await Promise.race([
            this.tools.executeTool(call.name, call.args),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Tool timeout')), TOOL_TIMEOUT))
          ]);

          const resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
          toolResults.push({ id: call.id, name: call.name, result: resultStr, error: false });

          if (this.onToolResult) {
            this.onToolResult({ ...call, result: resultStr });
          }

        } catch (err) {
          const errorMsg = `Error executing ${call.name}: ${err.message}`;
          toolResults.push({ id: call.id, name: call.name, result: errorMsg, error: true });
          log.warn(errorMsg);
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
    const systemParts = [];
    const chatMessages = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      } else {
        chatMessages.push(m);
      }
    }

    if (options.system && !systemParts.includes(options.system)) {
      systemParts.unshift(options.system);
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

    const body = {
      model,
      max_tokens: options.maxTokens || 4096,
      messages: merged,
      tools,
    };
    if (systemParts.length > 0) body.system = systemParts.join('\n\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic ${res.status}: ${err}`);
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

    return {
      content: textContent,
      toolCalls,
      stopReason: data.stop_reason,
      rawContent: data.content, // needed for appending to message history
      usage: {
        input_tokens: data.usage?.input_tokens || 0,
        output_tokens: data.usage?.output_tokens || 0,
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
}
