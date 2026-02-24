#!/usr/bin/env node

/**
 * QuantumClaw — The agent runtime with a knowledge graph for a brain.
 * https://github.com/QuantumClaw/QClaw
 *
 * MIT License | Copyright (c) 2026 QuantumClaw
 */

import { loadConfig } from './core/config.js';
import { SecretStore } from './security/secrets.js';
import { CredentialManager } from './credentials.js';
import { TrustKernel } from './security/trust-kernel.js';
import { AuditLog } from './security/audit.js';
import { MemoryManager } from './memory/manager.js';
import { ModelRouter } from './models/router.js';
import { AgentRegistry } from './agents/registry.js';
import { SkillLoader } from './skills/loader.js';
import { ChannelManager } from './channels/manager.js';
import { DashboardServer } from './dashboard/server.js';
import { Heartbeat } from './core/heartbeat.js';
import { ToolRegistry } from './tools/registry.js';
import { ToolExecutor } from './tools/executor.js';
import { getDb, closeDb } from './core/database.js';
import { DeliveryQueue } from './core/delivery-queue.js';
import { CompletionCache } from './core/completion-cache.js';
import { ExecApprovals } from './security/approvals.js';
import { banner } from './cli/brand.js';
import { log } from './core/logger.js';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

class QuantumClaw {
  constructor() {
    this.config = null;
    this.secrets = null;
    this.credentials = null;
    this.trustKernel = null;
    this.audit = null;
    this.memory = null;
    this.router = null;
    this.agents = null;
    this.skills = null;
    this.tools = null;
    this.toolExecutor = null;
    this.db = null;
    this.deliveryQueue = null;
    this.completionCache = null;
    this.approvals = null;
    this.channels = null;
    this.dashboard = null;
    this.heartbeat = null;
    this.degradationLevel = 1;
  }

  async start() {
    banner();
    log.info('Starting QuantumClaw...');

    // ── Layer 1: Security foundation (MUST succeed, no agent without security) ──
    try {
      this.config = await loadConfig();
      this.secrets = new SecretStore(this.config);
      this.trustKernel = new TrustKernel(this.config);

      // Audit is important but not fatal — catch separately
      try {
        this.audit = new AuditLog(this.config);
      } catch (auditErr) {
        log.warn(`Audit log failed: ${auditErr.message} — continuing without audit`);
        // Stub audit so downstream code doesn't crash
        this.audit = { log() {}, getRecent() { return []; }, getCosts() { return { total: 0, today: 0, entries: [] }; } };
      }

      await this.secrets.load();
      await this.trustKernel.load();
      if (this.audit.log) this.audit.log('system', 'startup', 'QuantumClaw starting');
    } catch (err) {
      log.error(`Security layer failed: ${err.message}`);
      log.error('Cannot start without security. Run `qclaw diagnose`');
      process.exit(1);
    }

    // ── Layer 1.5: AGEX credentials (auto-starts hub-lite, falls back to local secrets) ──
    try {
      // Default to local hub-lite if no hub URL configured
      if (!this.config.agex) this.config.agex = {};
      if (!this.config.agex.hubUrl && !process.env.AGEX_HUB_URL) {
        this.config.agex.hubUrl = 'http://localhost:4891';
      }

      this.credentials = new CredentialManager(this.config, this.secrets);
      await this.credentials.init();

      if (this.credentials.agexAvailable) {
        const status = this.credentials.status();
        log.success(`AGEX Hub connected (AID: ${status.aidId?.slice(0, 8)}..., Tier ${status.trustTier})`);
        this.audit.log('system', 'agex_connected', `Hub: ${status.hubUrl}`);
      } else {
        log.debug('AGEX Hub not available — using local secrets');
      }
    } catch (err) {
      log.debug(`AGEX: ${err.message} — using local secrets`);
      // CredentialManager wraps SecretStore, so fall back to raw secrets
      this.credentials = this.secrets;
    }

    log.success('Security layer ready');

    // ── Layer 1.7: Shared database (non-fatal — modules fall back to JSON) ──
    try {
      this.db = await getDb(this.config._dir);
      if (this.db) {
        // Wire up modules that support .attach(db) for SQLite-backed storage
        this.deliveryQueue = new DeliveryQueue(this.config);
        this.deliveryQueue.attach(this.db);

        this.completionCache = new CompletionCache(this.config);
        this.completionCache.attach(this.db);

        this.approvals = new ExecApprovals(this.config);
        this.approvals.attach(this.db);

        log.success('Shared database ready (SQLite)');
      } else {
        log.info('No SQLite available — using JSON fallbacks');
      }
    } catch (err) {
      log.debug(`Shared database: ${err.message} — modules will use JSON fallbacks`);
    }

    // Ensure stubs exist even if DB init failed
    if (!this.deliveryQueue) {
      this.deliveryQueue = new DeliveryQueue(this.config);
      this.deliveryQueue.attach(null);
    }
    if (!this.completionCache) {
      this.completionCache = new CompletionCache(this.config);
      this.completionCache.attach(null);
    }
    if (!this.approvals) {
      this.approvals = new ExecApprovals(this.config);
      this.approvals.attach(null);
    }

    // ── Layer 2: Memory (degrades: graph → sqlite) ──
    try {
      this.memory = new MemoryManager(this.config, this.credentials);
      const memoryStatus = await this.memory.connect();
      this.degradationLevel = memoryStatus.cognee ? 1 : 2;

      if (memoryStatus.cognee) {
        log.success(`Knowledge graph connected (${memoryStatus.entities} entities)`);
      } else {
        log.info('Memory: SQLite + vector (local)');
      }
    } catch (err) {
      log.warn(`Memory init: ${err.message} — continuing with basic memory`);
      log.warn('Continuing with no persistent memory — conversations will not be saved');
      this.degradationLevel = 4;
      // Create a minimal memory stub so downstream code doesn't crash
      this.memory = {
        cogneeConnected: false,
        knowledge: null,
        graph: null,
        vector: null,
        _jsonStore: null,
        _router: null,
        addMessage() {},
        getHistory() { return []; },
        async graphQuery() { return { results: [], source: 'offline' }; },
        setContext() {},
        getContext() { return null; },
        setRouter() {},
        _saveJsonStore() {},
        async disconnect() {}
      };
    }

    // ── Layer 3: Model routing (MUST succeed — no agent without a model) ──
    try {
      this.router = new ModelRouter(this.config, this.credentials);
      const routerStatus = await this.router.verify();
      if (routerStatus.models.length === 0) {
        throw new Error('No models verified. Check your API keys.');
      }
      log.success(`Models ready: ${routerStatus.models.join(', ')}`);
    } catch (err) {
      log.error(`Model router failed: ${err.message}`);
      log.error('Cannot start without at least one working model.');
      log.info('Run `qclaw onboard` to set up an AI provider.');
      process.exit(1);
    }

    // ── Layer 4: Skills (non-fatal) ──
    try {
      this.skills = new SkillLoader(this.config);
      const skillCount = await this.skills.loadAll();
      log.success(`${skillCount} skills loaded`);
    } catch (err) {
      log.warn(`Skill loading failed: ${err.message} — continuing without skills`);
      this.skills = { loadAll() { return 0; }, list() { return []; }, forAgent() { return []; } };
    }

    // ── Layer 4.5: Tools — MCP servers, API tools, built-ins (non-fatal) ──
    try {
      this.tools = new ToolRegistry(this.config, this.credentials);
      const toolStatus = await this.tools.init();

      // Wire the search_knowledge built-in to the live memory graph
      if (this.tools._builtins.has('search_knowledge') && this.memory.graphQuery) {
        const originalSearch = this.tools._builtins.get('search_knowledge');
        this.tools._builtins.set('search_knowledge', async (args) => {
          const graphResult = await this.memory.graphQuery(args.query || args.q || '');
          if (graphResult.results?.length > 0) {
            return graphResult.results.map(r => r.content || r).join('\n\n');
          }
          // Fall back to original built-in if no graph results
          return originalSearch ? await originalSearch(args) : 'No knowledge found.';
        });
      }

      // Wire the spawn_agent built-in for agentic sub-agent creation
      this.tools._builtins.set('spawn_agent', async (args) => {
        const { name, role, model_tier, scopes } = args;
        if (!name || !role) return 'Error: name and role are required';

        try {
          const { Agent } = await import('./agents/registry.js');
          const { existsSync, mkdirSync, writeFileSync } = await import('fs');
          const { join } = await import('path');

          const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '');
          const agentDir = join(this.config._dir, 'workspace', 'agents', safeName);
          mkdirSync(agentDir, { recursive: true });

          // Generate SOUL.md
          const soulContent = `# ${safeName}\n\nYou are **${safeName}**, a specialised sub-agent.\n\n## Role\n\n${role}\n\n## Rules\n\n- You are a ${model_tier || 'simple'}-tier agent — be token-efficient\n- Scoped access: ${(scopes || ['chat']).join(', ')}\n- Report to the primary agent\n`;
          writeFileSync(join(agentDir, 'SOUL.md'), soulContent);

          // Generate child AID
          let childAid = null;
          if (this.credentials?.generateChildAID) {
            try {
              childAid = await this.credentials.generateChildAID(safeName, role, scopes || []);
              writeFileSync(join(agentDir, 'aid.json'), JSON.stringify(childAid, null, 2));
            } catch {}
          }

          // Load into registry
          const agent = new Agent(safeName, agentDir, {
            router: this.router, memory: this.memory,
            audit: this.audit, toolExecutor: this.toolExecutor,
            trustKernel: this.trustKernel
          });
          await agent.load();
          this.agents.agents.set(safeName, agent);

          this.audit.log('system', 'agent_spawned', safeName, { role, scopes });

          const aidInfo = childAid ? ` AID: ${childAid.aid_id.slice(0, 12)}..., Tier ${childAid.trust_tier}.` : '';
          return `Agent "${safeName}" spawned successfully.${aidInfo} Role: ${role}. Scopes: ${(scopes || ['chat']).join(', ')}.`;
        } catch (err) {
          return `Failed to spawn agent: ${err.message}`;
        }
      });

      this.toolExecutor = new ToolExecutor(this.router, this.tools, {
        requireApproval: this.config.tools?.requireApproval || ['shell', 'file_write'],
        onToolCall: (call) => {
          log.debug(`Tool call: ${call.name}(${JSON.stringify(call.args).slice(0, 100)})`);
          this.audit.log('tool', call.name, JSON.stringify(call.args).slice(0, 200));
        },
      });

      if (toolStatus.tools > 0) {
        log.success(`${toolStatus.tools} tools ready (${toolStatus.servers} MCP servers)`);
      }
    } catch (err) {
      log.warn(`Tool system failed: ${err.message} — agent will work in chat-only mode`);
      this.toolExecutor = null;
    }

    // ── Layer 5: Agents (MUST succeed — at minimum the default agent) ──
    try {
      this.agents = new AgentRegistry(this.config, {
        memory: this.memory,
        router: this.router,
        skills: this.skills,
        trustKernel: this.trustKernel,
        audit: this.audit,
        secrets: this.credentials,
        config: this.config,
        toolExecutor: this.toolExecutor,
        completionCache: this.completionCache,
        deliveryQueue: this.deliveryQueue,
        approvals: this.approvals,
      });
      await this.agents.loadAll();

      // Copy primary AID to default agent's directory if not already there
      if (this.credentials?.aid) {
        const { existsSync, writeFileSync } = await import('fs');
        const { join } = await import('path');
        const primary = this.agents.primary();
        if (primary) {
          const aidFile = join(primary.dir, 'aid.json');
          if (!existsSync(aidFile)) {
            writeFileSync(aidFile, JSON.stringify(this.credentials.aid, null, 2));
          }
          primary.aid = this.credentials.aid;
        }
      }

      log.success(`${this.agents.count} agent(s) ready`);
    } catch (err) {
      log.error(`Agent registry failed: ${err.message}`);
      log.error('Cannot start without agents. Check workspace/agents/');
      process.exit(1);
    }

    // ── Layer 6: Channels (non-fatal, dashboard is the fallback) ──
    try {
      this.channels = new ChannelManager(this.config, this.agents, this.credentials);
      await this.channels.startAll();
    } catch (err) {
      log.warn(`Channel startup failed: ${err.message} — dashboard still available`);
    }

    // ── Layer 7: Dashboard (non-fatal but highly recommended) ──
    if (this.config.dashboard?.enabled !== false) {
      try {
        this.dashboard = new DashboardServer(this);
        const dashUrl = await this.dashboard.start();

        // Wire up dashboard broadcast to channels so Telegram messages appear in dashboard
        if (this.channels) {
          this.channels.setBroadcast((data) => this.dashboard.broadcast(data));
        }

        // If we generated a new token, save it to config for `qclaw dashboard` command
        if (this.dashboard.sessionToken && !this.config.dashboard?.authToken) {
          const { saveConfig } = await import('./core/config.js');
          if (!this.config.dashboard) this.config.dashboard = {};
          this.config.dashboard.authToken = this.dashboard.sessionToken;
          saveConfig(this.config);
        }

        log.success(`Dashboard: ${dashUrl}`);

        // Save dashboard URL to file so `qclaw dashboard` can re-show it
        try {
          writeFileSync(join(this.config._dir, 'dashboard.url'), dashUrl);
        } catch { /* non-fatal */ }

        // Auto-open in default browser (desktop only, not Termux)
        const isTermux = (await import('fs')).existsSync('/data/data/com.termux');
        if (!isTermux) {
          try {
            const { exec } = await import('child_process');
            const platform = process.platform;
            const cmd = platform === 'win32' ? `start "" "${dashUrl}"`
                      : platform === 'darwin' ? `open "${dashUrl}"`
                      : `xdg-open "${dashUrl}" 2>/dev/null || true`;
            exec(cmd);
          } catch { /* non-fatal */ }
        }

        // Show dashboard URL prominently
        log.info('');
        if (this.dashboard.tunnelUrl) {
          log.success('┌─────────────────────────────────────────────────┐');
          log.success('│  📡 DASHBOARD (any browser/device)              │');
          log.success('└─────────────────────────────────────────────────┘');
          log.info(`  ${dashUrl}`);
        } else {
          log.success('┌─────────────────────────────────────────────────┐');
          log.success('│  💻 DASHBOARD (local)                           │');
          log.success('└─────────────────────────────────────────────────┘');
          log.info(`  ${dashUrl}`);
        }
        log.info('');
        log.info('  Lost this URL? Run: qclaw dashboard');
      } catch (err) {
        log.warn(`Dashboard failed to start: ${err.message}`);
        log.info('Agent is still running on connected channels.');
      }
    }

    // ── Layer 8: Heartbeat (non-fatal) ──
    try {
      // Auto-enable learn mode if agent hasn't hatched yet (first boot experience)
      if (!this.config.agent?.hatched) {
        if (!this.config.heartbeat) this.config.heartbeat = {};
        if (!this.config.heartbeat.autoLearn) {
          this.config.heartbeat.autoLearn = {
            enabled: true,
            maxQuestionsPerDay: 5,
            minIntervalHours: 2,
            quietHoursStart: 22,
            quietHoursEnd: 8
          };
        }
      }
      this.heartbeat = new Heartbeat(this.config, this.agents, this.memory, this.audit);
      await this.heartbeat.start();
    } catch (err) {
      log.warn(`Heartbeat failed: ${err.message} — agent works without it`);
    }

    // ── Ready ──
    log.info('');
    log.success(`QuantumClaw is live. (degradation level ${this.degradationLevel}/5)`);
    this.audit.log('system', 'ready', `Level ${this.degradationLevel} — ${this.agents.count} agents`);

    // Show Telegram pairing instructions if no users paired yet
    if (this.config.channels?.telegram?.enabled && 
        (!this.config.channels.telegram.allowedUsers || this.config.channels.telegram.allowedUsers.length === 0)) {
      log.info('');
      log.info('  ┌─────────────────────────────────────────────────┐');
      log.info('  │  📱 PAIR TELEGRAM (open a new terminal tab)     │');
      log.info('  │                                                 │');
      log.info('  │  1. Send /start to your bot in Telegram         │');
      log.info('  │  2. Copy the 8-letter code it replies with      │');
      log.info('  │  3. In a new tab run:                           │');
      log.info('  │                                                 │');
      log.info('  │     qclaw pairing approve telegram CODE         │');
      log.info('  │                                                 │');
      log.info('  └─────────────────────────────────────────────────┘');
    }

    // Quick reference
    log.info('');
    log.info('  Quick reference:');
    log.info('  qclaw dashboard   re-show dashboard URL');
    log.info('  qclaw chat        chat in this terminal');
    log.info('  qclaw status      health check');
    log.info('  qclaw stop        stop agent');
    log.info('  qclaw help        all commands');
    log.info('');

    // Write PID file for `qclaw stop`
    this.pidFile = join(this.config._dir, 'qclaw.pid');
    writeFileSync(this.pidFile, String(process.pid));

    // Graceful shutdown
    const shutdown = async (signal) => {
      log.info(`\n${signal} received. Shutting down gracefully...`);
      try { this.audit.log('system', 'shutdown', signal); } catch { /* db might be closed */ }
      if (this.heartbeat) try { await this.heartbeat.stop(); } catch { /* */ }
      if (this.deliveryQueue) try { this.deliveryQueue.stop(); } catch { /* */ }
      if (this.channels) try { await this.channels.stopAll(); } catch { /* */ }
      if (this.dashboard) try { await this.dashboard.stop(); } catch { /* */ }
      if (this.credentials?.shutdown) try { await this.credentials.shutdown(); } catch { /* */ }
      if (this.memory?.disconnect) try { await this.memory.disconnect(); } catch { /* */ }
      try { closeDb(); } catch { /* */ }
      // Clean up PID file
      try { unlinkSync(this.pidFile); } catch { /* */ }
      log.info('Goodbye.');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}

// Start
const qclaw = new QuantumClaw();
qclaw.start();
