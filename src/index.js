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
      this.audit = new AuditLog(this.config);

      await this.secrets.load();
      await this.trustKernel.load();
      this.audit.log('system', 'startup', 'QuantumClaw starting');
    } catch (err) {
      log.error(`Security layer failed: ${err.message}`);
      log.error('Cannot start without security. Run `qclaw diagnose`');
      process.exit(1);
    }

    // ── Layer 1.5: AGEX credentials (optional, falls back to local secrets) ──
    try {
      this.credentials = new CredentialManager(this.config, this.secrets);
      await this.credentials.init();

      if (this.credentials.agexAvailable) {
        const status = this.credentials.status();
        log.success(`AGEX Hub connected (AID: ${status.aidId?.slice(0, 8)}..., Tier ${status.trustTier})`);
        this.audit.log('system', 'agex_connected', `Hub: ${status.hubUrl}`);
      } else {
        log.debug('AGEX Hub not configured — using local secrets');
      }
    } catch (err) {
      log.debug(`AGEX: ${err.message} — using local secrets`);
      // CredentialManager wraps SecretStore, so fall back to raw secrets
      this.credentials = this.secrets;
    }

    log.success('Security layer ready');

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

    // ── Layer 5: Agents (MUST succeed — at minimum the default agent) ──
    try {
      this.agents = new AgentRegistry(this.config, {
        memory: this.memory,
        router: this.router,
        skills: this.skills,
        trustKernel: this.trustKernel,
        audit: this.audit,
        secrets: this.credentials
      });
      await this.agents.loadAll();
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
      if (this.channels) try { await this.channels.stopAll(); } catch { /* */ }
      if (this.dashboard) try { await this.dashboard.stop(); } catch { /* */ }
      if (this.credentials?.shutdown) try { await this.credentials.shutdown(); } catch { /* */ }
      if (this.memory?.disconnect) try { await this.memory.disconnect(); } catch { /* */ }
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
