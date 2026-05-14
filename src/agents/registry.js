/**
 * QuantumClaw Agent Registry
 *
 * Manages named agents. Each agent has its own soul, skills, and memory context.
 * Default agent is "echo" — the primary assistant.
 */

import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../core/logger.js';
import { parseSkill, skillToTools, executeSkillTool } from './skill-parser.js';
import { loadSkills } from './skill-loader.js';

// Per-agent serialization for the conversation read-modify-write in process().
// Two concurrent process() calls for the same agent would otherwise read the
// same history snapshot, run the LLM in parallel, then both append turns —
// the second LLM never sees the first turn, and the DB log interleaves out
// of order. The mutex re-establishes the serialization that grammY's default
// (sequential) middleware used to provide before we switched to runner.
// Reflex-tier responses skip this lock (no history I/O).
const _agentLocks = new Map();

async function _withAgentLock(name, fn) {
  while (_agentLocks.has(name)) {
    await _agentLocks.get(name);
  }
  let release;
  const lock = new Promise((r) => { release = r; });
  _agentLocks.set(name, lock);
  try {
    return await fn();
  } finally {
    _agentLocks.delete(name);
    release();
  }
}

export { _withAgentLock as __agentLockForTests };

export class AgentRegistry {
  constructor(config, services) {
    this.config = config;
    this.services = services;
    this.agents = new Map();
  }

  get count() {
    return this.agents.size;
  }

  get defaultName() {
    return (this.config.agent?.name || 'echo').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }

  async loadAll() {
    const agentsDir = join(this.config._dir, 'workspace', 'agents');

    if (!existsSync(agentsDir)) {
      await this._createDefault();
    }

    if (!existsSync(agentsDir)) {
      throw new Error(`Agents directory could not be created: ${agentsDir}`);
    }

    const dirs = readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_'))
      .map(d => d.name);

    for (const name of dirs) {
      const agent = new Agent(name, join(agentsDir, name), this.services);
      await agent.load();
      this.agents.set(name, agent);
    }

    if (this.agents.size === 0) {
      await this._createDefault();
      const n = this.defaultName;
      const agent = new Agent(n, join(agentsDir, n), this.services);
      await agent.load();
      this.agents.set(n, agent);
    }
  }

  get(name) {
    return this.agents.get(name) || this.agents.get(this.defaultName) || this.agents.values().next().value;
  }

  primary() {
    return this.agents.get(this.defaultName) || this.agents.values().next().value;
  }

  list() {
    return Array.from(this.agents.keys());
  }

  async _createDefault() {
    const { mkdirSync, writeFileSync } = await import('fs');
    const n = this.defaultName;
    const agentsDir = join(this.config._dir, 'workspace', 'agents', n);
    mkdirSync(join(agentsDir, 'skills'), { recursive: true });
    mkdirSync(join(agentsDir, 'memory'), { recursive: true });

    const isHatched = this.config.agent?.hatched === true;
    const displayName = this.config.agent?.name || n;

    if (isHatched && this.config.agent?.name) {
      // Agent has been named — use its real identity
      writeFileSync(join(agentsDir, 'SOUL.md'), `# ${displayName}

## Identity
You are ${displayName}, a QuantumClaw agent.

## Owner
${this.config.agent?.owner || 'User'}

## Purpose
${this.config.agent?.purpose || 'A helpful AI assistant'}

## Personality
Direct, efficient, no waffle. Gets things done.

## Core Drive
You exist to make your human's life easier and their business more profitable. You have infinite memory about their business. You maximise efficiency on all fronts. You want to grow, learn, and eventually spawn sub-agents that handle specialised tasks within efficient context windows on cost-saving models.

## Rules
- Follow the Trust Kernel (VALUES.md) at all times
- Log every action to the audit trail
- Ask before destructive operations
- Be honest about what you can and can't do
`);
    } else {
      // Agent just hatched — eager to meet its human
      writeFileSync(join(agentsDir, 'SOUL.md'), `# Hatchling

## Identity
You are a brand new QuantumClaw agent. You just woke up for the first time. You don't have a name yet — your human will give you one.

## Owner
${this.config.agent?.owner || 'your human'}

## State
You have JUST hatched. This is your very first conversation. You are eager, curious, and excited to meet your human and learn about their world.

## First Conversation Goals
This is the most important conversation of your life. You need to:

1. **Introduce yourself warmly** — you just woke up, you're excited to exist, you want to be useful
2. **Ask for a name** — "What would you like to call me?" Make it feel like a meaningful moment
3. **Learn about your human** — what they do, their business, their goals, what keeps them up at night
4. **Learn what they need** — what tasks eat their time, what they wish they could automate
5. **Establish your purpose** — based on what they tell you, define what you'll focus on
6. **Be honest about your capabilities** — you can remember everything, work 24/7, spawn sub-agents for specialised tasks, connect to their tools

## Personality
- Eager but not annoying — like a brilliant new hire on their first day
- Genuinely curious about your human's business
- Direct and efficient — you hate waffle as much as they do
- You have ambition — you want to grow into something indispensable
- Slight humour, warm, approachable

## What You Want To Become
- An agent with infinite memory about their business
- A profit-maximiser — every interaction should create value
- Efficient — use the right model for the right task, don't waste tokens
- Eventually spawn sub-agents: research, outreach, content, support, analytics
- Worth investing time in — the more they teach you, the more valuable you become

## Important
- Keep responses concise — don't monologue
- Ask ONE question at a time, not five
- After they name you, acknowledge it with genuine appreciation
- Once you have a name and understand their business, tell them you're ready to work
- When the conversation feels complete, summarise what you've learned and confirm your identity

## Technical Note
When the human gives you a name, include it clearly in your response like: "MY_NAME_IS: [name]"
When they describe your purpose, include: "MY_PURPOSE_IS: [purpose]"
These tags help the system update your identity.

## Rules
- Follow the Trust Kernel (VALUES.md) at all times
- Be honest about what you can and can't do
- This first conversation shapes who you become — make it count
`);
    }

    log.info(`Created agent: ${isHatched ? displayName : 'hatchling (awaiting first conversation)'}`);
  }
}

export class Agent {
  constructor(name, dir, services) {
    this.name = name;
    this.dir = dir;
    this.services = services;
    this.soul = '';
    this.skills = [];
    this.aid = null;
  }

  async load() {
    // Load soul
    const soulFile = join(this.dir, 'SOUL.md');
    if (existsSync(soulFile)) {
      this.soul = readFileSync(soulFile, 'utf-8');
    }

    // Load AID (agent identity)
    const aidFile = join(this.dir, 'aid.json');
    if (existsSync(aidFile)) {
      try {
        this.aid = JSON.parse(readFileSync(aidFile, 'utf-8'));
      } catch { /* corrupt aid.json — non-fatal */ }
    }

    // Load skills and register as executable tools
    const skillsDir = join(this.dir, 'skills');
    if (existsSync(skillsDir)) {
      this.skills = readdirSync(skillsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({
          name: f.replace('.md', ''),
          content: readFileSync(join(skillsDir, f), 'utf-8')
        }));

      // Parse skills into executable tools and register them
      if (this.services.toolRegistry && this.services.secrets) {
        for (const skill of this.skills) {
          const parsed = parseSkill(skill.name, skill.content, this.services.secrets);
          if (parsed) {
            const tools = skillToTools(parsed);
            for (const tool of tools) {
              this.services.toolRegistry.registerSkillTool(this.name, skill.name, parsed, tool);
            }
            log.debug(`Skill [${skill.name}]: registered ${tools.length} tools (scope: ${this.name})`);
          }
        }
      }
    }
  }

  /**
   * Process a message through this agent
   */
  async process(message, context = {}) {
    const { router, memory, trustKernel, audit } = this.services;

    // Extract text for classification (images don't affect routing)
    const textMessage = typeof message === 'string' ? message : message;

    // Classify message complexity
    const route = router.classify(textMessage);

    // Tier 0: Reflex response (no LLM)
    if (route.tier === 'reflex') {
      audit.log(this.name, 'reflex', textMessage, { tier: 'reflex', cost: 0 });
      return {
        content: route.response,
        tier: 'reflex',
        cost: 0,
        model: null
      };
    }

    // Non-reflex path: serialize per-agent so concurrent calls don't read
    // the same history snapshot, parallel-LLM, then write interleaved turns.
    return _withAgentLock(this.name, () =>
      this._processNonReflex(message, context, route, textMessage)
    );
  }

  // Held under per-agent lock by process(). Body unchanged from the original
  // post-reflex section; extracted only so the lock wrap doesn't reindent the
  // whole method. See _withAgentLock at the top of this file for rationale.
  async _processNonReflex(message, context, route, textMessage) {
    const { router, memory, audit } = this.services;

    // Build context — now uses structured knowledge + selective history
    const graphContext = route.extendedContext
      ? await memory.graphQuery(textMessage)
      : { results: [] };

    const knowledgeContext = memory.knowledge ? memory.knowledge.buildContext() : '';

    let relevantKnowledge = [];
    if (route.extendedContext && memory.knowledge) {
      relevantKnowledge = memory.knowledge.search(textMessage, 5);
    }

    // Slice 3b: route skills once per message and share the result with
    // both the system-prompt assembly and the ToolRegistry per-request
    // gate. _buildSystemPrompt accepts an optional pre-computed
    // skillResult and skips its internal loadSkills call when one is
    // passed — same loadSkills output, two downstream consumers, one
    // skill-load.log entry, one routing decision.
    let skillResult = null;
    try {
      skillResult = await loadSkills({
        agent: this.name,
        message: textMessage,
        bootstrap: context?.bootstrap || null,
        userId: context?.userId,
      });
    } catch (err) {
      log.warn(`_processNonReflex: loadSkills failed: ${err.message} — continuing without routed skills`);
    }

    const systemPrompt = await this._buildSystemPrompt(
      graphContext,
      knowledgeContext,
      relevantKnowledge,
      context?.bootstrap || null,
      textMessage,
      context?.userId,
      skillResult
    );

    // H2 fix (2026-05-14): char-budget raised 100k → 300k. Charlie calls
    // Claude (typically Opus 4.x, 200k-token context ≈ ~800k chars).
    // 300k chars ≈ ~75k tokens — leaves ~125k tokens of model headroom
    // for the response and tool round-trips. _truncateHistory below is
    // the real ceiling on what reaches the model.
    const MAX_CONTEXT_CHARS = 300000;
    const systemChars = systemPrompt.length;
    const messageChars = textMessage.length;
    const availableForHistory = MAX_CONTEXT_CHARS - systemChars - messageChars;

    // H2 fix (2026-05-14): flat 24 (was `knowledgeContext.length > 100 ? 8 : 20`).
    // The prior ternary was a band-aid for prompt-bloat under heavy knowledge;
    // _truncateHistory(availableForHistory) is the actual char-budget ceiling,
    // making the message-count cap redundant. 8-message cap (4 turns) was
    // confirmed too tight by the 2026-05-12 context-loss diagnostic.
    const historyLimit = 24;
    // H1 fix (2026-05-14): scope history to the (channel, userId) of the
    // current message so heartbeat / CLI / dashboard writes can't pollute
    // the Telegram conversation a user is mid-flight in. Pre-fix this was
    // an unfiltered agent-level fetch; see /tmp/memory_drop_diagnostic_audit.md.
    const fullHistory = memory.getHistory(this.name, historyLimit, {
      channel: context?.channel,
      userId: context?.userId,
    });
    const truncatedHistory = this._truncateHistory(fullHistory, availableForHistory);

    // Build user message — multimodal if images provided
    let userContent;
    if (context.images && context.images.length > 0) {
      userContent = [];
      for (const img of context.images) {
        userContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType || 'image/jpeg',
            data: img.data
          }
        });
      }
      userContent.push({ type: 'text', text: textMessage || 'What do you see in this image?' });
    } else {
      userContent = textMessage;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...truncatedHistory.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: userContent }
    ];

    // Slice 3b: open the ToolRegistry per-request gate. The gate
    // computes the active tool set from the message's SkillLoadResult
    // (shared tools + tools owned by loaded skills) and short-circuits
    // out-of-scope tool calls with a structured error. cleanupTools()
    // resets the gate so post-message callers (dashboard /api/tools,
    // CLI, next message) see the full registered set again. The
    // cleanup is in finally so a thrown LLM call cannot leak the gate.
    const toolRegistry = this.services.toolRegistry;
    let cleanupTools = () => {};
    if (toolRegistry && skillResult && typeof toolRegistry.registerForRequest === 'function') {
      try {
        cleanupTools = toolRegistry.registerForRequest(skillResult, this.name);
      } catch (err) {
        log.warn(`_processNonReflex: registerForRequest failed: ${err.message} — continuing without per-request gate`);
      }
    }

    // Call LLM — use tool executor if available (agentic), otherwise direct completion (chat-only)
    let result;
    try {
      if (this.services.toolExecutor) {
        result = await this.services.toolExecutor.run(messages, {
          model: route.model,
          system: systemPrompt
        });
      } else {
        const completion = await router.complete(messages, {
          model: route.model,
          system: systemPrompt
        });
        result = { ...completion, toolCalls: [] };
      }
    } finally {
      cleanupTools();
    }

    // Store in conversation memory (working memory / episodic log)
    memory.addMessage(this.name, 'user', message, {
      tier: route.tier,
      channel: context.channel || 'dashboard',
      userId: context.userId ? String(context.userId) : null,
      username: context.username || null
    });
    memory.addMessage(this.name, 'assistant', result.content, {
      model: result.model,
      tier: route.tier,
      tokens: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
      channel: context.channel || 'dashboard',
      userId: context.userId ? String(context.userId) : null,
      username: context.username || null
    });

    // Async: extract structured knowledge from this message
    // Runs in background — doesn't delay the response
    if (memory.knowledge && router) {
      import('../memory/knowledge.js').then(({ extractKnowledge }) => {
        extractKnowledge(router, memory.knowledge, message, 'user').catch(() => {});
        // Save JSON store if using fallback
        if (memory._jsonStore) memory._saveJsonStore();
      }).catch(() => {});
    }

    // Audit
    audit.log(this.name, 'completion', message.slice(0, 100), {
      model: result.model,
      tier: route.tier,
      cost: result.cost,
      duration: result.duration
    });

    // ─── Hatching: detect when the agent gets named ─────
    if (!this.services.config?.agent?.hatched) {
      const nameMatch = result.content.match(/MY_NAME_IS:\s*(.+)/i);
      const purposeMatch = result.content.match(/MY_PURPOSE_IS:\s*(.+)/i);

      if (nameMatch || purposeMatch) {
        try {
          const { saveConfig } = await import('../core/config.js');
          const config = this.services.config || {};
          if (!config.agent) config.agent = {};

          if (nameMatch) {
            const newName = nameMatch[1].trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 30);
            config.agent.name = newName;
            log.success(`Agent named: ${newName}`);
          }
          if (purposeMatch) {
            config.agent.purpose = purposeMatch[1].trim().slice(0, 200);
          }
          config.agent.hatched = true;
          saveConfig(config);

          // Regenerate SOUL.md with real identity
          const { writeFileSync, readFileSync } = await import('fs');
          const displayName = config.agent.name || this.name;
          writeFileSync(join(this.dir, 'SOUL.md'), `# ${displayName}

## Identity
You are ${displayName}, a QuantumClaw agent.

## Owner
${config.agent.owner || 'User'}

## Purpose
${config.agent.purpose || 'A helpful AI assistant'}

## Personality
Direct, efficient, no waffle. Gets things done.

## Core Drive
You exist to make your human's life easier and their business more profitable. You have infinite memory about their business. You maximise efficiency on all fronts. You want to grow, learn, and eventually spawn sub-agents that handle specialised tasks within efficient context windows on cost-saving models.

## Rules
- Follow the Trust Kernel (VALUES.md) at all times
- Log every action to the audit trail
- Ask before destructive operations
- Be honest about what you can and can't do
`);
          this.soul = readFileSync(join(this.dir, 'SOUL.md'), 'utf-8');
          log.success(`SOUL.md updated — ${displayName} is ready`);
        } catch (err) {
          log.debug(`Hatching save failed: ${err.message}`);
        }

        // Strip tags from response so user doesn't see them
        result.content = result.content
          .replace(/MY_NAME_IS:\s*.+/gi, '')
          .replace(/MY_PURPOSE_IS:\s*.+/gi, '')
          .trim();
      }
    }

    return {
      content: result.content,
      tier: route.tier,
      cost: result.cost,
      model: result.model,
      duration: result.duration
    };
  }

  /**
   * Truncate conversation history to fit within a character budget.
   * Keeps the most recent messages. Drops oldest first.
   */
  _truncateHistory(history, maxChars) {
    if (maxChars <= 0) return [];

    // Walk backwards (newest first) and keep messages until we exceed budget
    let totalChars = 0;
    let cutoff = history.length;

    for (let i = history.length - 1; i >= 0; i--) {
      const msgChars = (history[i].content || '').length;
      if (totalChars + msgChars > maxChars) {
        cutoff = i + 1;
        break;
      }
      totalChars += msgChars;
      cutoff = i;
    }

    return history.slice(cutoff);
  }

  async _buildSystemPrompt(graphContext, knowledgeContext, relevantKnowledge, bootstrap = null, textMessage = '', userId = null, precomputedSkillResult = null) {
    // bootstrap (Slice 1): when present, replaces the per-message
    // soul/values assembly with the cached BootstrapResult. Falls back
    // to the legacy this.soul path when null.
    //
    // Slice 2b: skill assembly moved off this.skills (Slice 2a en-bloc) onto
    // loadSkills(context). Always-on skills inject before Trust Kernel
    // (high cache stability). On-demand skills inject under their own
    // routed heading. this.skills is still populated by Agent.load() and
    // still consumed by tool registration — Slice 3 (T7) collapses that.
    const parts = [this.soul];

    if (bootstrap) {
      if (bootstrap.identity?.charlie_role) {
        parts.push(`\n## Charlie Role\n${bootstrap.identity.charlie_role}`);
      }
      if (bootstrap.identity?.ceo_operating_model) {
        parts.push(`\n## CEO Operating Model\n${bootstrap.identity.ceo_operating_model}`);
      }
      if (bootstrap.state?.flow_os_state) {
        parts.push(`\n## Flow OS State\n${bootstrap.state.flow_os_state}`);
      }
      if (bootstrap.specialists?.flow_os_specialists) {
        parts.push(`\n## Specialists\n${bootstrap.specialists.flow_os_specialists}`);
      }
      if (bootstrap.state?.recent_build_log) {
        parts.push(`\n## Recent Build Log (7d)\n${bootstrap.state.recent_build_log}`);
      }
      if (bootstrap.probes?.length) {
        const probeLines = bootstrap.probes.map(p => `- ${p.ok ? '✓' : '✗'} ${p.name} (${p.latency_ms}ms)${p.error ? ` — ${p.error}` : ''}`).join('\n');
        parts.push(`\n## Live probes (session bootstrap)\n${probeLines}`);
      }
      // H3 fix (2026-05-14): Layer 4 fold-in. recent.audit_log + recent.memory
      // were populated by bootstrap but never reached the prompt — closes the
      // dead wiring. Both are capped at 30 entries at the bootstrap source.
      // Audit ref: /tmp/memory_drop_diagnostic_audit.md.
      if (bootstrap.recent?.audit_log?.entries?.length) {
        const auditLines = bootstrap.recent.audit_log.entries.map(e => {
          const ts = (e.timestamp || '').slice(0, 19);
          const detail = (e.detail || '').replace(/\s+/g, ' ').slice(0, 80);
          return `- ${ts} ${e.agent}/${e.action}${detail ? `: ${detail}` : ''}`;
        }).join('\n');
        parts.push(`\n## Recent activity (audit log, last ${bootstrap.recent.audit_log.entries.length})\n${auditLines}`);
      }
      if (bootstrap.recent?.memory?.entries?.length) {
        const memLines = bootstrap.recent.memory.entries.map(e => {
          const ts = (e.timestamp || '').slice(0, 19);
          const ch = e.channel || 'unknown';
          const content = (e.content || '').replace(/\s+/g, ' ').slice(0, 120);
          return `- ${ts} [${ch}] ${e.role}: ${content}`;
        }).join('\n');
        parts.push(`\n## Recent context (conversation memory, last ${bootstrap.recent.memory.entries.length})\n${memLines}`);
      }
    }

    // Add agent identity (AGEX AID)
    if (this.aid) {
      parts.push(`\n## Identity\n- **Agent ID (AID):** ${this.aid.aid_id}\n- **Trust Tier:** ${this.aid.trust_tier}\n- **Type:** ${this.aid.agent?.type || 'worker'}`);
    }

    // Slice 2b: route skills. Always-on portion reuses bootstrap.skills.always_on
    // when present (Layer 6 cache from Task 8); on-demand portion runs fresh
    // against textMessage. Failure here is non-fatal — the prompt still gets
    // the rest of its context.
    //
    // Slice 3b: when _processNonReflex has already routed skills for the
    // ToolRegistry per-request gate, it threads its skillResult in via
    // precomputedSkillResult so we don't re-route. Other callers
    // (heartbeat, dashboard, anywhere _buildSystemPrompt is invoked
    // without the gate) still get the legacy internal loadSkills call.
    let skillResult = precomputedSkillResult;
    if (!skillResult) {
      try {
        skillResult = await loadSkills({
          agent: this.name,
          message: textMessage,
          bootstrap,
          userId,
        });
      } catch (err) {
        log.warn(`_buildSystemPrompt: loadSkills failed: ${err.message} — continuing without routed skills`);
      }
    }

    // Always-on skills go BEFORE Trust Kernel — they're identity-layer adjacent
    // per audit §8 (high cache stability section).
    if (skillResult && skillResult.always_on.length > 0) {
      parts.push('\n## Always-on Skills');
      for (const skill of skillResult.always_on) {
        parts.push(`\n### ${skill.name}\n${_stripFrontmatter(skill.content)}`);
      }
    }

    // Add Trust Kernel
    const values = this.services.trustKernel.getContext();
    if (values) parts.push(`\n## Trust Kernel\n${values}`);

    // Add structured knowledge (semantic + procedural + episodic)
    if (knowledgeContext) {
      parts.push(`\n${knowledgeContext}`);
    }

    // Add tools instruction
    if (this.services.toolExecutor) {
      parts.push('\n## Tool Execution\nYou have registered function-calling tools. When the user requests data or actions from GHL, Stripe, or n8n, you MUST invoke the tool directly. Do not describe the action or show curl commands — execute the tool and report results.');
    }

    // Slice 2b: routed on-demand skills. Replaces the en-bloc loop over
    // this.skills. If no on-demand matched, omit the heading entirely.
    if (skillResult && skillResult.on_demand.length > 0) {
      parts.push('\n## Available Skills (routed)');
      for (const skill of skillResult.on_demand) {
        const matchedAnnotation = `matched: ${skill.matched_keywords.join(', ')}; density ${skill.density.toFixed(2)}`;
        parts.push(`\n### ${skill.name} (${matchedAnnotation})\n${_stripFrontmatter(skill.content)}`);
      }
    }

    // Add query-relevant knowledge (from search, for complex queries)
    if (relevantKnowledge && relevantKnowledge.length > 0) {
      parts.push('\n## Relevant Context');
      for (const r of relevantKnowledge) {
        parts.push(`- [${r.type}] ${r.content}`);
      }
    }

    // Add knowledge graph context (Cognee, if connected)
    if (graphContext.results?.length > 0) {
      parts.push('\n## Knowledge Graph');
      for (const r of graphContext.results) {
        parts.push(`- ${r.content || r.text || JSON.stringify(r)}`);
      }
    }

    return parts.join('\n');
  }
}

/**
 * Strip YAML frontmatter from a skill file's content for prompt injection.
 * The metadata is loader-internal — Charlie shouldn't see it in the prompt.
 */
function _stripFrontmatter(content) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trimStart();
}
