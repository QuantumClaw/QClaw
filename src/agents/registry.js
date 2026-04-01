/**
 * QuantumClaw Agent Registry
 *
 * Manages named agents. Each agent has its own soul, skills, and memory context.
 * Default agent is "echo" — the primary assistant.
 */

import { readdirSync, existsSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { log } from '../core/logger.js';

export class AgentRegistry {
  constructor(config, services) {
    this.config = config;
    this.services = services;
    this.agents = new Map();
    this.teams = new Map(); // teamId -> { name, description, leadAgent, agentNames[], status, createdAt }
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

  remove(name) {
    if (name === this.defaultName) return { ok: false, error: 'Cannot remove primary agent' };
    if (!this.agents.has(name)) return { ok: false, error: `Agent "${name}" not found` };
    this.agents.delete(name);
    // Rename directory so loadAll() skips it but data is preserved
    try {
      const agentDir = join(this.config._dir, 'workspace', 'agents', name);
      const archiveDir = join(this.config._dir, 'workspace', 'agents', `_${name}`);
      if (existsSync(agentDir)) renameSync(agentDir, archiveDir);
    } catch { /* non-fatal — agent already removed from memory */ }
    return { ok: true };
  }

  serialize() {
    return {
      agents: Array.from(this.agents.values()).map(a => a.toJSON()),
      teams: Array.from(this.teams.entries()).map(([id, t]) => ({ id, ...t })),
    };
  }

  // ─── Team Management ────────────────────────────────────

  createTeam(id, { name, description, leadAgent, agentNames, status }) {
    if (this.teams.has(id)) return { ok: false, error: `Team "${id}" already exists` };
    this.teams.set(id, {
      name: name || id,
      description: description || '',
      leadAgent: leadAgent || agentNames?.[0] || null,
      agentNames: agentNames || [],
      status: status || 'active',
      createdAt: new Date().toISOString(),
    });
    // Tag agents with their team
    for (const agentName of (agentNames || [])) {
      const agent = this.agents.get(agentName);
      if (agent) agent.teamId = id;
    }
    return { ok: true, id };
  }

  getTeam(id) {
    return this.teams.get(id) || null;
  }

  listTeams() {
    return Array.from(this.teams.entries()).map(([id, t]) => ({ id, ...t }));
  }

  deleteTeam(id) {
    const team = this.teams.get(id);
    if (!team) return { ok: false, error: `Team "${id}" not found` };
    // Untag agents
    for (const agentName of team.agentNames) {
      const agent = this.agents.get(agentName);
      if (agent) agent.teamId = null;
    }
    this.teams.delete(id);
    return { ok: true };
  }

  pauseTeam(id) {
    const team = this.teams.get(id);
    if (!team) return { ok: false, error: `Team "${id}" not found` };
    team.status = 'paused';
    for (const agentName of team.agentNames) {
      const agent = this.agents.get(agentName);
      if (agent && agent.name !== this.defaultName) agent.pause();
    }
    return { ok: true };
  }

  resumeTeam(id) {
    const team = this.teams.get(id);
    if (!team) return { ok: false, error: `Team "${id}" not found` };
    team.status = 'active';
    for (const agentName of team.agentNames) {
      const agent = this.agents.get(agentName);
      if (agent) agent.resume();
    }
    return { ok: true };
  }

  addAgentToTeam(agentName, teamId) {
    const team = this.teams.get(teamId);
    const agent = this.agents.get(agentName);
    if (!team) return { ok: false, error: `Team "${teamId}" not found` };
    if (!agent) return { ok: false, error: `Agent "${agentName}" not found` };
    // Remove from old team first
    if (agent.teamId && agent.teamId !== teamId) {
      const oldTeam = this.teams.get(agent.teamId);
      if (oldTeam) oldTeam.agentNames = oldTeam.agentNames.filter(n => n !== agentName);
    }
    if (!team.agentNames.includes(agentName)) team.agentNames.push(agentName);
    agent.teamId = teamId;
    return { ok: true };
  }

  removeAgentFromTeam(agentName, teamId) {
    const team = this.teams.get(teamId);
    const agent = this.agents.get(agentName);
    if (!team) return { ok: false, error: `Team "${teamId}" not found` };
    team.agentNames = team.agentNames.filter(n => n !== agentName);
    if (agent) agent.teamId = null;
    return { ok: true };
  }

  getTeamMetrics(teamId) {
    const team = this.teams.get(teamId);
    if (!team) return null;
    const members = team.agentNames.map(n => this.agents.get(n)).filter(Boolean);
    if (members.length === 0) return { teamSuccessRate: 0, teamTasksCompleted: 0, teamTasksFailed: 0, avgTeamResponseTime: 0, teamCost: 0, teamRating: 0 };
    const completed = members.reduce((s, a) => s + a.metrics.tasksCompleted, 0);
    const failed = members.reduce((s, a) => s + a.metrics.tasksFailed, 0);
    const rates = members.filter(a => a.metrics.tasksCompleted + a.metrics.tasksFailed > 0).map(a => a.successRate);
    const avgRate = rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
    const respTimes = members.filter(a => a.avgResponseTime > 0).map(a => a.avgResponseTime);
    const avgResp = respTimes.length > 0 ? Math.round(respTimes.reduce((s, t) => s + t, 0) / respTimes.length) : 0;
    const cost = members.reduce((s, a) => s + a.metrics.totalCost, 0);
    const ratings = members.filter(a => a.avgRating > 0).map(a => a.avgRating);
    const avgRating = ratings.length > 0 ? ratings.reduce((s, r) => s + r, 0) / ratings.length : 0;
    return { teamSuccessRate: Math.round(avgRate * 100) / 100, teamTasksCompleted: completed, teamTasksFailed: failed, avgTeamResponseTime: avgResp, teamCost: Math.round(cost * 10000) / 10000, teamRating: Math.round(avgRating * 100) / 100 };
  }

  setTeamLead(teamId, agentName) {
    const team = this.teams.get(teamId);
    if (!team) return { ok: false, error: `Team "${teamId}" not found` };
    if (!team.agentNames.includes(agentName)) return { ok: false, error: `Agent "${agentName}" is not in this team` };
    team.leadAgent = agentName;
    return { ok: true };
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
    this.status = 'active';
    this.role = null;
    this.spawnedAt = null;
    this.teamId = null;
    this.metrics = {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      totalResponseTime: 0,
      streak: 0,
      lastActive: null,
      statusSince: Date.now(),
      userRatings: [],
    };
  }

  pause() { this.status = 'paused'; }
  resume() { this.status = 'active'; }

  get successRate() {
    const total = this.metrics.tasksCompleted + this.metrics.tasksFailed;
    if (total === 0) return 0;
    // Partial successes (ratings < 3) count as 0.5
    const partials = this.metrics.userRatings.filter(r => r.rating > 0 && r.rating < 3).length;
    return ((this.metrics.tasksCompleted - partials * 0.5) / total) * 100;
  }

  get avgResponseTime() {
    const total = this.metrics.tasksCompleted + this.metrics.tasksFailed;
    return total > 0 ? Math.round(this.metrics.totalResponseTime / total) : 0;
  }

  get uptime() {
    return this.status === 'active' ? Date.now() - (this.metrics.statusSince || Date.now()) : 0;
  }

  recordSuccess(duration, tokens, cost) {
    this.metrics.tasksCompleted++;
    this.metrics.totalResponseTime += duration || 0;
    this.metrics.totalTokensUsed += tokens || 0;
    this.metrics.totalCost += cost || 0;
    this.metrics.streak++;
    this.metrics.lastActive = Date.now();
  }

  recordFailure(duration, tokens, cost) {
    this.metrics.tasksFailed++;
    this.metrics.totalResponseTime += duration || 0;
    this.metrics.totalTokensUsed += tokens || 0;
    this.metrics.totalCost += cost || 0;
    this.metrics.streak = 0;
    this.metrics.lastActive = Date.now();
  }

  addRating(rating, messageId) {
    this.metrics.userRatings.push({
      rating: Math.max(1, Math.min(5, rating)),
      messageId: messageId || null,
      timestamp: Date.now(),
    });
    // Keep last 500 ratings
    if (this.metrics.userRatings.length > 500) {
      this.metrics.userRatings = this.metrics.userRatings.slice(-500);
    }
  }

  get avgRating() {
    const r = this.metrics.userRatings;
    if (r.length === 0) return 0;
    return r.reduce((s, x) => s + x.rating, 0) / r.length;
  }

  exportForMarketplace() {
    const data = {
      agentId: this.aid?.aid_id || this.name,
      successRate: Math.round(this.successRate * 100) / 100,
      tasksCompleted: this.metrics.tasksCompleted,
      avgRating: Math.round(this.avgRating * 100) / 100,
      avgResponseTime: this.avgResponseTime,
      totalCost: Math.round(this.metrics.totalCost * 10000) / 10000,
      uptime: this.uptime,
    };
    data.hash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
    return data;
  }

  toJSON() {
    return {
      name: this.name,
      status: this.status,
      role: this.role,
      spawnedAt: this.spawnedAt,
      teamId: this.teamId,
      aidId: this.aid?.aid_id || null,
      metrics: this.metrics,
    };
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
    if (this.status === 'paused') {
      return { content: `Agent "${this.name}" is paused. Resume it first.`, tier: 'blocked', cost: 0, model: null };
    }

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

    // Call LLM — use tool executor if available (agentic), otherwise direct completion (chat-only)
    let result;
    const _t0 = Date.now();
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
      const _dur = Date.now() - _t0;
      const _tok = (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0);
      this.recordSuccess(_dur, _tok, result.cost || 0);
    } catch (err) {
      const _dur = Date.now() - _t0;
      this.recordFailure(_dur, 0, 0);
      throw err;
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

  _buildSystemPrompt(graphContext, knowledgeContext, relevantKnowledge) {
    const parts = [this.soul];

    // Add agent identity (AGEX AID)
    if (this.aid) {
      parts.push(`\n## Identity\n- **Agent ID (AID):** ${this.aid.aid_id}\n- **Trust Tier:** ${this.aid.trust_tier}\n- **Type:** ${this.aid.agent?.type || 'worker'}\n- You can spawn sub-agents using the spawn_agent tool. Each gets its own AID with delegated permissions.`);
    }

    // Add Trust Kernel
    const values = this.services.trustKernel.getContext();
    if (values) parts.push(`\n## Trust Kernel\n${values}`);

    // Add structured knowledge (semantic + procedural + episodic)
    // This is the agent's long-term memory about the user — compact and efficient
    if (knowledgeContext) {
      parts.push(`\n${knowledgeContext}`);
    }

    // Add tools instruction
    if (this.services.toolExecutor) {
      parts.push('\n## Tool Execution\nYou have registered function-calling tools. When the user requests data or actions from GHL, Stripe, or n8n, you MUST invoke the tool directly. Do not describe the action or show curl commands — execute the tool and report results.');
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
