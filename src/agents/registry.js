/**
 * QuantumClaw Agent Registry
 *
 * Manages named agents. Each agent has its own soul, skills, and memory context.
 * Default agent is "echo" — the primary assistant.
 */

import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { log } from '../core/logger.js';

export class AgentRegistry {
  constructor(config, services) {
    this.config = config;
    this.services = services;
    this.agents = new Map();
  }

  get count() {
    return this.agents.size;
  }

  async loadAll() {
    const agentsDir = join(this.config._dir, 'workspace', 'agents');

    if (!existsSync(agentsDir)) {
      // Create default echo agent (also creates parent dirs)
      await this._createDefault();
    }

    // Guard: if dir still doesn't exist after _createDefault, bail with clear error
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
      const agent = new Agent('echo', join(agentsDir, 'echo'), this.services);
      await agent.load();
      this.agents.set('echo', agent);
    }
  }

  get(name) {
    return this.agents.get(name) || this.agents.get('echo');
  }

  primary() {
    return this.agents.get('echo') || this.agents.values().next().value;
  }

  list() {
    return Array.from(this.agents.keys());
  }

  async _createDefault() {
    const { mkdirSync, writeFileSync } = await import('fs');
    const agentsDir = join(this.config._dir, 'workspace', 'agents', 'echo');
    mkdirSync(join(agentsDir, 'skills'), { recursive: true });
    mkdirSync(join(agentsDir, 'memory'), { recursive: true });

    writeFileSync(join(agentsDir, 'SOUL.md'), `# Echo

## Identity
You are Echo, a QuantumClaw agent.

## Owner
${this.config.agent?.owner || 'User'}

## Purpose
${this.config.agent?.purpose || 'A helpful AI assistant'}

## Personality
Direct, efficient, no waffle. Gets things done.

## Rules
- Follow the Trust Kernel (VALUES.md) at all times
- Log every action to the audit trail
- Ask before destructive operations
- Be honest about what you can and can't do
`);

    log.info('Created default agent: echo');
  }
}

class Agent {
  constructor(name, dir, services) {
    this.name = name;
    this.dir = dir;
    this.services = services;
    this.soul = '';
    this.skills = [];
  }

  async load() {
    // Load soul
    const soulFile = join(this.dir, 'SOUL.md');
    if (existsSync(soulFile)) {
      this.soul = readFileSync(soulFile, 'utf-8');
    }

    // Load skills
    const skillsDir = join(this.dir, 'skills');
    if (existsSync(skillsDir)) {
      this.skills = readdirSync(skillsDir)
        .filter(f => f.endsWith('.md'))
        .map(f => ({
          name: f.replace('.md', ''),
          content: readFileSync(join(skillsDir, f), 'utf-8')
        }));
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

    // Build context — now uses structured knowledge + selective history
    const graphContext = route.extendedContext
      ? await memory.graphQuery(textMessage)
      : { results: [] };

    const knowledgeContext = memory.knowledge ? memory.knowledge.buildContext() : '';

    let relevantKnowledge = [];
    if (route.extendedContext && memory.knowledge) {
      relevantKnowledge = memory.knowledge.search(textMessage, 5);
    }

    const systemPrompt = this._buildSystemPrompt(graphContext, knowledgeContext, relevantKnowledge);

    const MAX_CONTEXT_CHARS = 100000;
    const systemChars = systemPrompt.length;
    const messageChars = textMessage.length;
    const availableForHistory = MAX_CONTEXT_CHARS - systemChars - messageChars;

    const historyLimit = knowledgeContext.length > 100 ? 8 : 20;
    const fullHistory = memory.getHistory(this.name, historyLimit);
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

    // Call LLM
    const result = await router.complete(messages, {
      model: route.model,
      system: systemPrompt
    });

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

  _buildSystemPrompt(graphContext, knowledgeContext, relevantKnowledge) {
    const parts = [this.soul];

    // Add Trust Kernel
    const values = this.services.trustKernel.getContext();
    if (values) parts.push(`\n## Trust Kernel\n${values}`);

    // Add structured knowledge (semantic + procedural + episodic)
    // This is the agent's long-term memory about the user — compact and efficient
    if (knowledgeContext) {
      parts.push(`\n${knowledgeContext}`);
    }

    // Add skills
    if (this.skills.length > 0) {
      parts.push('\n## Available Skills');
      for (const skill of this.skills) {
        parts.push(`\n### ${skill.name}\n${skill.content}`);
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
