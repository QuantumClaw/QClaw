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
    return this.agents.get('charlie') || this.agents.get('echo') || this.agents.values().next().value;
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
    const channel = context.channel || "cli";
    const { router, memory, trustKernel, audit } = this.services;

    // Tool path: explicit skill command execution (HTTP)
    const skillCommand = this._extractSkillCommand(message);
    if (skillCommand) {
      try {
        const started = Date.now();
        const toolResult = await this._executeSkillHttp(skillCommand);
        const duration = Date.now() - started;

        const content = this._formatSkillResult(skillCommand, toolResult);

        memory.addMessage(this.name, 'user', message, { tier: "tool", channel });
        memory.addMessage(this.name, 'assistant', content, {
          model: 'skill-http',
          tier: 'tool',
          tokens: 0, channel
        });

        audit.log(this.name, 'skill_http', `${skillCommand.skill} ${skillCommand.method} ${skillCommand.path}`, { channel,
          model: 'skill-http',
          tier: 'tool',
          cost: 0,
          duration
        });

        return {
          content,
          tier: 'tool',
          cost: 0,
          model: null,
          duration
        };
      } catch (err) {
        const msg =
          `Skill execution failed: ${err.message}\n\n` +
          `Try one of these formats:\n` +
          `- /skill ghl GET /contacts/?email=name@example.com\n` +
          `- /stripe recent-invoices 5\n` +
          `- /n8n action health_check {"env":"prod"}`;

        audit.log(this.name, 'skill_http_error', err.message, { channel,
          model: 'skill-http',
          tier: 'tool',
          cost: 0
        });

        return {
          content: msg,
          tier: 'tool',
          cost: 0,
          model: null
        };
      }
    }

    // Classify message complexity
    const route = router.classify(message);

    // Tier 0: Reflex response (no LLM)
    if (route.tier === 'reflex') {
      audit.log(this.name, 'reflex', message, { tier: 'reflex', cost: 0, channel });
      return {
        content: route.response,
        tier: 'reflex',
        cost: 0,
        model: null
      };
    }

    // Build context
    const graphContext = route.extendedContext
      ? await memory.graphQuery(message)
      : { results: [] };

    const systemPrompt = this._buildSystemPrompt(graphContext);

    // Token budget for history: reserve space for system prompt, current message, and response
    // Rough estimate: 1 token ≈ 4 chars. Most models have 128k context but we cap conservatively.
    const MAX_CONTEXT_CHARS = 100000; // ~25k tokens — leaves plenty of room for response
    const systemChars = systemPrompt.length;
    const messageChars = message.length;
    const availableForHistory = MAX_CONTEXT_CHARS - systemChars - messageChars;

    // Get history and truncate to fit
    const fullHistory = memory.getHistory(this.name, { channel, limit: 20 });
    const truncatedHistory = this._truncateHistory(fullHistory, availableForHistory);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...truncatedHistory.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    // Call LLM
    const result = await router.complete(messages, {
      model: route.model,
      system: systemPrompt
    });

    // Store in memory
    memory.addMessage(this.name, "user", message, { tier: route.tier, channel });
    memory.addMessage(this.name, 'assistant', result.content, {
      model: result.model,
      tier: route.tier,
      tokens: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0), channel
    });

    // Audit
    audit.log(this.name, 'completion', message.slice(0, 100), { channel,
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

  _buildSystemPrompt(graphContext) {
    const parts = [this.soul];

    // Add Trust Kernel
    const values = this.services.trustKernel.getContext();
    if (values) parts.push(`\n## Trust Kernel\n${values}`);

    // Add skills
    if (this.skills.length > 0) {
      parts.push('\n## Available Skills');
      for (const skill of this.skills) {
        parts.push(`\n### ${skill.name}\n${skill.content}`);
      }
    }

    // Add knowledge graph context
    if (graphContext.results?.length > 0) {
      parts.push('\n## Relevant Knowledge');
      for (const r of graphContext.results) {
        parts.push(`- ${r.content || r.text || JSON.stringify(r)}`);
      }
    }

    return parts.join('\n');
  }

  _extractSkillCommand(message) {
    const text = (message || '').trim();

    // Generic explicit command:
    // /skill <name> <METHOD> <path> [json-body]
    const generic = text.match(/^\/skill\s+([a-zA-Z0-9_-]+)\s+(GET|POST|PUT|PATCH|DELETE)\s+(\S+)(?:\s+([\s\S]+))?$/i);
    if (generic) {
      const [, skill, method, path, bodyText] = generic;
      return {
        skill: skill.toLowerCase(),
        method: method.toUpperCase(),
        path,
        body: bodyText ? this._parseJsonLoose(bodyText) : undefined
      };
    }

    // Convenience: /ghl contact-by-email someone@example.com
    const ghlByEmail = text.match(/^\/ghl\s+contact-by-email\s+([^\s]+)$/i);
    if (ghlByEmail) {
      const email = encodeURIComponent(ghlByEmail[1]);
      return {
        skill: 'ghl',
        method: 'GET',
        path: `/contacts/?email=${email}`
      };
    }

    // Convenience: /stripe recent-invoices [limit]
    const stripeRecent = text.match(/^\/stripe\s+recent-invoices(?:\s+(\d+))?$/i);
    if (stripeRecent) {
      const limit = Math.min(Math.max(parseInt(stripeRecent[1] || '5', 10), 1), 25);
      return {
        skill: 'stripe',
        method: 'GET',
        path: `/invoices?limit=${limit}`
      };
    }

    // Convenience: /n8n action <action> [json-payload]
    const n8nAction = text.match(/^\/n8n\s+action\s+([a-zA-Z0-9_.-]+)(?:\s+([\s\S]+))?$/i);
    if (n8nAction) {
      const payload = n8nAction[2] ? this._parseJsonLoose(n8nAction[2]) : {};
      return {
        skill: 'n8n-router',
        method: 'POST',
        path: '/webhook/qclaw-router',
        body: { action: n8nAction[1], payload }
      };
    }

    return null;
  }

  async _executeSkillHttp(command) {
    const skill = this._getSkillSpec(command.skill);
    if (!skill) {
      throw new Error(`Unknown skill "${command.skill}"`);
    }
    if (!skill.baseUrl) {
      throw new Error(`Skill "${command.skill}" is missing Base URL`);
    }

    const pathOnly = command.path.split('?')[0];
    if (!this._isEndpointAllowed(skill, command.method, pathOnly)) {
      throw new Error(`Endpoint not allowed by skill: ${command.method} ${pathOnly}`);
    }

    const targetUrl = this._resolveUrl(skill.baseUrl, command.path);
    this._assertAllowedDomain(skill, targetUrl);

    const headers = await this._resolveHeaders(skill.headers || []);
    if (command.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(targetUrl, {
      method: command.method,
      headers,
      body: command.body !== undefined ? JSON.stringify(command.body) : undefined,
      signal: AbortSignal.timeout(20000)
    });

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    const isJson = contentType.includes('application/json');
    const body = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const preview = typeof body === 'string' ? body.slice(0, 500) : JSON.stringify(body).slice(0, 500);
      throw new Error(`HTTP ${res.status} from ${new URL(targetUrl).hostname}: ${preview}`);
    }

    return {
      status: res.status,
      url: targetUrl,
      body
    };
  }

  _getSkillSpec(name) {
    const target = (name || '').toLowerCase();
    for (const s of this.skills) {
      if ((s.name || '').toLowerCase() === target) {
        return this._parseSkillSpec(s.name, s.content);
      }
    }
    return null;
  }

  _parseSkillSpec(name, content) {
    const spec = {
      name,
      baseUrl: null,
      headers: [],
      endpoints: [],
      permissions: { http: [] }
    };

    let section = null;
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();

      if (line === '## Auth') { section = 'auth'; continue; }
      if (line === '## Endpoints') { section = 'endpoints'; continue; }
      if (line === '## Permissions') { section = 'permissions'; continue; }
      if (line.startsWith('## ')) { section = null; continue; }

      if (section === 'auth') {
        if (line.startsWith('Base URL:')) {
          spec.baseUrl = line.slice('Base URL:'.length).trim();
        }
        if (line.startsWith('Header:')) {
          spec.headers.push(line.slice('Header:'.length).trim());
        }
      }

      if (section === 'endpoints') {
        const m = line.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)/i);
        if (m) spec.endpoints.push({ method: m[1].toUpperCase(), path: m[2] });
      }

      if (section === 'permissions' && line.startsWith('- http:')) {
        const m = line.match(/\[([^\]]*)\]/);
        if (m) {
          spec.permissions.http = m[1]
            .split(',')
            .map(x => x.trim())
            .filter(Boolean);
        }
      }
    }

    return spec;
  }

  _isEndpointAllowed(skill, method, pathOnly) {
    if (!skill.endpoints.length) return false;

    return skill.endpoints.some(ep => {
      if (ep.method !== method) return false;
      const regex = this._endpointPathToRegex(ep.path);
      return regex.test(pathOnly);
    });
  }

  _endpointPathToRegex(pathPattern) {
    const escaped = pathPattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{\\\{[^}]+\\\}\\\}/g, '[^/?#]+');
    return new RegExp(`^${escaped}$`);
  }

  _resolveUrl(baseUrl, path) {
    if (/^https?:\/\//i.test(path)) return path;
    const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
  }

  _assertAllowedDomain(skill, targetUrl) {
    const allowed = skill.permissions?.http || [];
    if (!allowed.length) {
      throw new Error(`Skill "${skill.name}" has no allowed http domains`);
    }

    const host = new URL(targetUrl).hostname.toLowerCase();
    const ok = allowed.some(domain => {
      const d = domain.toLowerCase();
      return host === d || host.endsWith(`.${d}`);
    });

    if (!ok) {
      throw new Error(`Domain "${host}" not in skill allowlist`);
    }
  }

  async _resolveHeaders(headerLines) {
    const headers = {};

    for (const line of headerLines) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      headers[key] = await this._resolveSecretsInText(value);
    }

    return headers;
  }

  async _resolveSecretsInText(text) {
    const matches = [...text.matchAll(/\{\{secrets\.([a-zA-Z0-9_-]+)\}\}/g)];
    if (matches.length === 0) return text;

    let out = text;
    for (const m of matches) {
      const key = m[1];
      const value = await this.services.secrets.get(key);
      if (!value) throw new Error(`Missing secret: ${key}`);
      out = out.replace(m[0], String(value).trim());
    }
    return out;
  }

  _parseJsonLoose(text) {
    const t = (text || '').trim();
    if (!t) return {};
    try {
      return JSON.parse(t);
    } catch {
      return { value: t };
    }
  }

  _formatSkillResult(command, result) {
    let bodyText = '';
    if (typeof result.body === 'string') {
      bodyText = result.body;
    } else {
      bodyText = JSON.stringify(result.body, null, 2);
    }

    if (bodyText.length > 3500) {
      bodyText = bodyText.slice(0, 3500) + '\n... (truncated)';
    }

    return [
      `Executed ${command.skill} ${command.method} ${command.path}`,
      `Status: ${result.status}`,
      '',
      bodyText
    ].join('\n');
  }
}
