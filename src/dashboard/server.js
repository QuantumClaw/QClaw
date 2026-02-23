/**
 * QuantumClaw Dashboard
 *
 * Local web UI. Chat, skills, memory graph, config, costs, audit.
 * Express server + WebSocket for real-time chat.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { log } from '../core/logger.js';
import { readFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class DashboardServer {
  constructor(qclaw) {
    this.qclaw = qclaw;
    this.config = qclaw.config;
    this.app = express();
    this.server = null;
    this.wss = null;
    this.tunnel = null;
    this.tunnelUrl = null;
  }

  async start() {
    const port = this.config.dashboard?.port || 3000;
    const isTermux = existsSync('/data/data/com.termux');
    // Desktop: localhost only. Mobile/Termux: bind all interfaces for tunnel
    const host = this.config.dashboard?.host || (isTermux ? '0.0.0.0' : '127.0.0.1');

    // Generate session auth token with expiry
    const tokenAge = this.config.dashboard?.tokenExpiry || 86400000; // 24h default
    if (!this.config.dashboard?.authToken && !process.env.DASHBOARD_AUTH_TOKEN) {
      const { randomBytes } = await import('crypto');
      this.sessionToken = randomBytes(16).toString('hex');
      this.tokenCreatedAt = Date.now();
      process.env.DASHBOARD_AUTH_TOKEN = this.sessionToken;
    } else {
      this.sessionToken = this.config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN;
      this.tokenCreatedAt = this.config.dashboard?.tokenCreatedAt || Date.now();
    }
    this.tokenExpiry = tokenAge;

    // PIN protection (set during onboard or via config)
    this.pin = this.config.dashboard?.pin || null;

    // Auth lockout tracking
    this.authAttempts = new Map(); // ip -> { count, lockedUntil }
    this.AUTH_MAX_ATTEMPTS = 5;
    this.AUTH_LOCKOUT_MS = 900000; // 15 minutes

    this.app.use(express.json({ limit: '20mb' }));

    // API routes
    this._setupAPI();

    // Serve dashboard UI
    this.app.get('/', (req, res) => {
      res.send(this._renderDashboard());
    });

    // Serve terminal onboarding UI
    this.app.get('/onboard', (req, res) => {
      try {
        const dir = dirname(fileURLToPath(import.meta.url));
        res.send(readFileSync(join(dir, 'onboard.html'), 'utf-8'));
      } catch {
        try {
          res.send(readFileSync(join(process.cwd(), 'src', 'dashboard', 'onboard.html'), 'utf-8'));
        } catch {
          res.redirect('/');
        }
      }
    });

    // Web onboard: save config from the browser UI
    this.app.post('/api/onboard', async (req, res) => {
      try {
        const { provider, model, apiKey, wantTg, tgToken, name } = req.body || {};
        if (!provider || !name) return res.status(400).json({ error: 'Missing provider or name' });

        const { loadConfig, saveConfig } = await import('../core/config.js');
        const { SecretStore } = await import('../security/secrets.js');
        const config = await loadConfig();

        config.agent = { name: 'QClaw', owner: name, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
        config.models = config.models || {};
        config.models.primary = { provider, model: model || 'auto' };
        config.channels = config.channels || {};
        if (wantTg && tgToken) {
          config.channels.telegram = { enabled: true, dmPolicy: 'pairing', allowedUsers: [] };
        }

        saveConfig(config);

        const secrets = new SecretStore(config);
        await secrets.load();
        if (apiKey) secrets.set(`${provider}_api_key`, apiKey);
        if (wantTg && tgToken) secrets.set('telegram_bot_token', tgToken);

        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Create HTTP server
    this.server = createServer(this.app);

    // WebSocket for real-time chat
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this._setupWebSocket();

    // Find available port
    const actualPort = await this._listen(host, port);
    this.actualPort = actualPort;
    const localHost = (host === '0.0.0.0' || host === '127.0.0.1') ? 'localhost' : host;
    const localUrl = `http://${localHost}:${actualPort}`;

    // Build the clickable URL with token as query param (more reliable than hash across shells)
    this.dashUrl = `${localUrl}/?token=${this.sessionToken}`;

    // Start tunnel — smart defaults:
    // - Termux/Android: always tunnel (can't access localhost from phone browser)
    // - Desktop: localhost only (unless explicitly configured or has tunnel token)
    let tunnelType = process.env.QCLAW_TUNNEL || this.config.dashboard?.tunnel || 'auto';
    if (tunnelType === 'auto') {
      const hasTunnelToken = this.config.dashboard?.tunnelToken
        || process.env.CLOUDFLARE_TUNNEL_TOKEN;

      if (hasTunnelToken) {
        // Persistent tunnel token exists — always use it
        tunnelType = 'cloudflare';
      } else if (isTermux) {
        // Termux: need tunnel for mobile access
        try {
          const { execSync } = await import('child_process');
          execSync('cloudflared --version', { stdio: 'ignore' });
          tunnelType = 'cloudflare';
        } catch {
          tunnelType = 'none';
          log.warn('cloudflared not found — dashboard is localhost only');
        }
      } else {
        // Desktop: localhost is fine, no tunnel needed
        tunnelType = 'none';
      }
    }

    if (tunnelType && tunnelType !== 'none') {
      try {
        this.tunnelUrl = await this._startTunnel(tunnelType, actualPort);
        this.dashUrl = `${this.tunnelUrl}/?token=${this.sessionToken}`;
        log.success(`Tunnel: ${this.tunnelUrl}`);

        // Save persistent tunnel URL to config (so it survives restarts)
        const hasTunnelToken = this.config.dashboard?.tunnelToken
          || this.qclaw.credentials?.get?.('cloudflare_tunnel_token')
          || process.env.CLOUDFLARE_TUNNEL_TOKEN;
        if (hasTunnelToken && this.tunnelUrl) {
          try {
            const { saveConfig } = await import('../core/config.js');
            this.config.dashboard.tunnelUrl = this.tunnelUrl;
            saveConfig(this.config);
          } catch { /* non-fatal */ }
        }
      } catch (err) {
        log.warn(`Tunnel (${tunnelType}) failed: ${err.message} — dashboard is local only`);
      }
    }

    // Poll delivery queue for autolearn messages and broadcast to dashboard
    this._deliveryPoller = setInterval(async () => {
      try {
        const queueDir = join(this.config._dir, 'workspace', 'delivery-queue');
        if (!existsSync(queueDir)) return;
        const files = readdirSync(queueDir).filter(f => f.startsWith('autolearn_') && f.endsWith('.json'));
        for (const file of files) {
          try {
            const data = JSON.parse(readFileSync(join(queueDir, file), 'utf-8'));
            // Broadcast to dashboard
            this.broadcast({
              type: 'autolearn',
              question: data.question,
              agent: data.agent,
              timestamp: data.timestamp
            });
            // Delete after delivery
            unlinkSync(join(queueDir, file));
          } catch { /* corrupted file, skip */ }
        }
      } catch { /* queue dir doesn't exist yet */ }
    }, 15000); // check every 15s

    return this.dashUrl;
  }

  async stop() {
    if (this._wsHeartbeat) clearInterval(this._wsHeartbeat);
    if (this._deliveryPoller) clearInterval(this._deliveryPoller);
    if (this.tunnel) {
      try { await this._stopTunnel(); } catch { /* best effort */ }
    }
    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
  }

  _setupAPI() {
    // Rate limiter: track requests per IP per minute
    const rateLimit = new Map();
    const RATE_LIMIT = 30;
    const RATE_WINDOW = 60000;

    const rateLimitCleanup = setInterval(() => {
      const now = Date.now();
      for (const [key, val] of rateLimit) {
        if (now - val.start > RATE_WINDOW) rateLimit.delete(key);
      }
      // Clean expired lockouts
      for (const [key, val] of this.authAttempts) {
        if (val.lockedUntil && now > val.lockedUntil) this.authAttempts.delete(key);
      }
    }, 120000);
    rateLimitCleanup.unref();

    this.app.use((req, res, next) => {
      // Skip auth for HTML pages, health check, and PIN verify endpoint
      if (req.path === '/' || req.path === '/onboard' || req.path === '/favicon.ico' || 
          req.path === '/api/health' || req.path === '/api/auth/verify-pin') return next();

      const ip = req.ip || req.socket.remoteAddress;

      // Check auth lockout
      const lockout = this.authAttempts.get(ip);
      if (lockout?.lockedUntil && Date.now() < lockout.lockedUntil) {
        const remaining = Math.ceil((lockout.lockedUntil - Date.now()) / 60000);
        return res.status(429).json({ error: `Locked out. Try again in ${remaining} minutes.` });
      }

      // Token auth
      const authToken = this.config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN;
      if (authToken) {
        const provided = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
        if (provided !== authToken) {
          // Track failed attempt
          const attempts = this.authAttempts.get(ip) || { count: 0 };
          attempts.count++;
          if (attempts.count >= this.AUTH_MAX_ATTEMPTS) {
            attempts.lockedUntil = Date.now() + this.AUTH_LOCKOUT_MS;
            log.warn(`Dashboard auth lockout: ${ip} (${this.AUTH_MAX_ATTEMPTS} failed attempts)`);
          }
          this.authAttempts.set(ip, attempts);
          return res.status(401).json({ error: 'Unauthorised' });
        }

        // Token expiry check (skip for localhost connections)
        const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
        if (!isLocal && this.tokenCreatedAt && this.tokenExpiry) {
          if (Date.now() - this.tokenCreatedAt > this.tokenExpiry) {
            return res.status(401).json({ error: 'Token expired. Run: qclaw dashboard' });
          }
        }

        // Reset failed attempts on success
        this.authAttempts.delete(ip);
      }

      // Rate limit check
      const now = Date.now();
      const entry = rateLimit.get(ip);
      if (entry && now - entry.start < RATE_WINDOW) {
        entry.count++;
        if (entry.count > RATE_LIMIT) {
          return res.status(429).json({ error: 'Rate limited. Try again in a minute.' });
        }
      } else {
        rateLimit.set(ip, { start: now, count: 1 });
      }

      next();
    });

    // PIN verification endpoint (for dashboard UI to check PIN before showing content)
    this.app.post('/api/auth/verify-pin', (req, res) => {
      if (!this.pin) {
        return res.json({ ok: true, pinRequired: false });
      }
      const ip = req.ip || req.socket.remoteAddress;
      
      // Check lockout
      const lockout = this.authAttempts.get(ip);
      if (lockout?.lockedUntil && Date.now() < lockout.lockedUntil) {
        const remaining = Math.ceil((lockout.lockedUntil - Date.now()) / 60000);
        return res.status(429).json({ error: `Locked out. Try again in ${remaining} minutes.` });
      }

      const { pin } = req.body;
      if (String(pin) === String(this.pin)) {
        this.authAttempts.delete(ip);
        return res.json({ ok: true });
      }
      
      // Track failed PIN attempt
      const attempts = this.authAttempts.get(ip) || { count: 0 };
      attempts.count++;
      if (attempts.count >= this.AUTH_MAX_ATTEMPTS) {
        attempts.lockedUntil = Date.now() + this.AUTH_LOCKOUT_MS;
        log.warn(`Dashboard PIN lockout: ${ip} (${this.AUTH_MAX_ATTEMPTS} failed attempts)`);
      }
      this.authAttempts.set(ip, attempts);
      return res.status(401).json({ error: 'Wrong PIN', attemptsLeft: this.AUTH_MAX_ATTEMPTS - attempts.count });
    });

    // Check if PIN is required (no auth needed for this)
    this.app.get('/api/auth/pin-required', (req, res) => {
      res.json({ pinRequired: !!this.pin });
    });

    // Health endpoint is always open (for Docker health checks, monitoring)
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'running',
        degradationLevel: this.qclaw.degradationLevel,
        agents: this.qclaw.agents.count,
        cognee: this.qclaw.memory.cogneeConnected,
        agex: this.qclaw.credentials?.status?.() || { mode: 'local' },
        tunnel: this.tunnelUrl || null
      });
    });

    // Agent chat endpoint (supports images via base64)
    this.app.post('/api/chat', async (req, res) => {
      try {
        const { message, agent: agentName, images } = req.body;
        const agent = this.qclaw.agents.get(agentName) || this.qclaw.agents.primary();
        const context = { channel: 'dashboard' };
        if (images && images.length > 0) {
          context.images = images; // [{ data: base64, mediaType: 'image/jpeg' }]
        }
        const result = await agent.process(message, context);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Costs
    this.app.get('/api/costs', (req, res) => {
      res.json(this.qclaw.audit.costSummary());
    });

    // Audit log
    this.app.get('/api/audit', (req, res) => {
      const limit = parseInt(req.query.limit) || 50;
      res.json(this.qclaw.audit.recent(limit));
    });

    // Agents list (with stats)
    this.app.get('/api/agents', (req, res) => {
      const agents = [];
      for (const name of this.qclaw.agents.list()) {
        const agent = this.qclaw.agents.get(name);
        const threads = this.qclaw.memory.getThreads(name);
        const totalMessages = threads.reduce((sum, t) => sum + t.messageCount, 0);
        agents.push({
          name: agent.name,
          model: this.qclaw.config.models?.primary?.model || 'auto',
          provider: this.qclaw.config.models?.primary?.provider || 'unknown',
          skills: agent.skills?.length || 0,
          threads: threads.length,
          messages: totalMessages,
          isPrimary: agent.name === this.qclaw.agents.primary()?.name
        });
      }
      res.json(agents);
    });

    // Skills list
    this.app.get('/api/skills', (req, res) => {
      res.json(this.qclaw.skills.list().map(s => ({
        name: s.name,
        endpoints: s.endpoints.length,
        hasCode: s.hasCode,
        reviewed: s.reviewed,
        source: s.source
      })));
    });

    // Memory search
    this.app.post('/api/memory/search', async (req, res) => {
      try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'query required' });
        const results = await this.qclaw.memory.graphQuery(query);
        res.json(results);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── Conversation Threads ───────────────────────────────
    this.app.get('/api/threads', (req, res) => {
      const agent = this.qclaw.agents.primary();
      if (!agent) return res.json([]);
      const threads = this.qclaw.memory.getThreads(agent.name);
      res.json(threads);
    });

    this.app.get('/api/threads/history', (req, res) => {
      const agent = this.qclaw.agents.primary();
      if (!agent) return res.json([]);
      const { channel, userId } = req.query;
      const limit = parseInt(req.query.limit) || 50;
      const history = this.qclaw.memory.getHistory(agent.name, limit, {
        channel: channel || undefined,
        userId: userId || undefined
      });
      res.json(history);
    });

    // ─── Stats ──────────────────────────────────────────────
    this.app.get('/api/stats', (req, res) => {
      const memStats = this.qclaw.memory.getStats();
      const costStats = this.qclaw.audit.costSummary();
      res.json({ memory: memStats, costs: costStats });
    });

    // ─── Config Management ──────────────────────────────────
    this.app.get('/api/config', (req, res) => {
      const { _dir, _file, ...safe } = this.qclaw.config;
      if (safe.dashboard?.authToken) safe.dashboard.authToken = '***';
      if (safe.dashboard?.pin) safe.dashboard.pin = '***';
      res.json(safe);
    });

    this.app.post('/api/config', async (req, res) => {
      try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key required' });
        const blocked = ['_dir', '_file', 'dashboard.authToken', 'dashboard.pin'];
        if (blocked.includes(key)) return res.status(403).json({ error: 'Cannot modify this key via API' });

        const { saveConfig } = await import('../core/config.js');
        const keys = key.split('.');
        let target = this.qclaw.config;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]] || typeof target[keys[i]] !== 'object') target[keys[i]] = {};
          target = target[keys[i]];
        }
        let parsed = value;
        if (value === 'true') parsed = true;
        else if (value === 'false') parsed = false;
        else if (typeof value === 'string' && !isNaN(value) && value !== '') parsed = Number(value);
        target[keys[keys.length - 1]] = parsed;
        saveConfig(this.qclaw.config);
        res.json({ ok: true, key, value: parsed });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Channel Status ─────────────────────────────────────
    this.app.get('/api/channels', (req, res) => {
      const channels = [];
      for (const ch of (this.qclaw.channels?.channels || [])) {
        const name = ch.channelConfig?.channelName || 'unknown';
        const paired = ch.channelConfig?.allowedUsers?.length || 0;
        const pending = ch.pendingPairings?.size || 0;
        const botName = ch.botInfo?.username || null;
        channels.push({ name, status: 'active', paired, pending, botName });
      }
      channels.push({ name: 'dashboard', status: 'active', tunnel: this.tunnelUrl || null });
      res.json(channels);
    });

    // ─── Agent Restart ──────────────────────────────────────
    this.app.post('/api/restart', async (req, res) => {
      res.json({ ok: true, message: 'Restarting...' });
      setTimeout(() => { process.exit(0); }, 500);
    });

    // Pairing: list pending codes
    this.app.get('/api/pairing/pending', (req, res) => {
      const channelFilter = req.query.channel;
      const pending = [];

      for (const channel of (this.qclaw.channels?.channels || [])) {
        if (channel.pendingPairings && channel.pendingPairings instanceof Map) {
          const channelName = channel.channelConfig?.channelName || 'telegram';
          if (channelFilter && channelName !== channelFilter) continue;

          for (const [code, data] of channel.pendingPairings) {
            // Skip expired (1 hour)
            if (Date.now() - data.timestamp > 3600000) continue;
            pending.push({ code, channel: channelName, ...data });
          }
        }
      }

      res.json(pending);
    });

    // Pairing: approve a code
    this.app.post('/api/pairing/approve', async (req, res) => {
      try {
        const { channel: channelName, code } = req.body;

        if (!channelName || !code) {
          return res.status(400).json({ error: 'Missing channel or code' });
        }

        // Find the channel
        const channel = (this.qclaw.channels?.channels || []).find(c => {
          return c.constructor.name.toLowerCase().includes(channelName.toLowerCase()) ||
                 c.channelConfig?.channelName === channelName;
        });

        if (!channel || !channel.approvePairing) {
          return res.status(404).json({ error: `Channel ${channelName} not found or doesn't support pairing` });
        }

        const result = await channel.approvePairing(code);
        if (result) {
          // Send confirmation to the user in Telegram
          if (channel.bot) {
            channel.bot.api.sendMessage(result.chatId, '✓ Paired successfully! Send me a message.').catch(() => {});
          }
          res.json(result);
        } else {
          res.status(404).json({ error: 'Code not found or expired' });
        }
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

  }

  _setupWebSocket() {
    this.wss.on('connection', (ws, req) => {
      // Check auth token if configured
      const authToken = this.config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN;
      if (authToken) {
        const url = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token');
        if (token !== authToken) {
          ws.send(JSON.stringify({ type: 'error', error: 'Unauthorised' }));
          ws.close(4001, 'Unauthorised');
          return;
        }
      }

      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', async (data) => {
        try {
          const { message, agent: agentName, images } = JSON.parse(data);
          const agent = this.qclaw.agents.get(agentName) || this.qclaw.agents.primary();

          // Send typing indicator
          ws.send(JSON.stringify({ type: 'typing', agent: agent.name }));

          const context = { channel: 'dashboard' };
          if (images && images.length > 0) {
            context.images = images;
          }

          const result = await agent.process(message, context);

          ws.send(JSON.stringify({
            type: 'response',
            ...result
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
      });
    });

    // Heartbeat to detect dead connections
    this._wsHeartbeat = setInterval(() => {
      this.wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
  }

  /**
   * Broadcast a message to all connected dashboard clients.
   * Used by channels (Telegram etc.) to show messages in real-time.
   */
  broadcast(data) {
    if (!this.wss) return;
    const payload = JSON.stringify(data);
    this.wss.clients.forEach(ws => {
      if (ws.readyState === 1) { // OPEN
        try { ws.send(payload); } catch { /* dead socket */ }
      }
    });
  }

  _renderDashboard() {
    const dir = dirname(fileURLToPath(import.meta.url));
    try {
      return readFileSync(join(dir, 'ui.html'), 'utf-8');
    } catch {
      try {
        return readFileSync(join(process.cwd(), 'src', 'dashboard', 'ui.html'), 'utf-8');
      } catch {
        return '<html><body style="background:#0a0a0f;color:#e4e4ef;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><h1>Dashboard ui.html not found</h1></body></html>';
      }
    }
  }

  // ─── Tunnel support ──────────────────────────────────────────

  // ─── Tunnel support ──────────────────────────────────────────

  /**
   * Start a tunnel to expose the dashboard publicly.
   * Supports: lt (localtunnel), cloudflare, ngrok
   */
  async _startTunnel(type, port) {
    switch (type) {
      case 'lt':
      case 'localtunnel':
        return this._tunnelLocalTunnel(port);
      case 'cloudflare':
        return this._tunnelCloudflare(port);
      case 'ngrok':
        return this._tunnelNgrok(port);
      default:
        throw new Error(`Unknown tunnel type: ${type}. Use: lt, cloudflare, or ngrok`);
    }
  }

  /**
   * localtunnel — free, no signup, npm package
   * npm install -g localtunnel (or we spawn npx)
   */
  async _tunnelLocalTunnel(port) {
    const { spawn } = await import('child_process');
    const subdomain = this.config.dashboard?.tunnel_subdomain || undefined;

    const args = ['localtunnel', '--port', String(port)];
    if (subdomain) args.push('--subdomain', subdomain);

    return new Promise((resolve, reject) => {
      const proc = spawn('npx', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      this.tunnel = proc;
      let resolved = false;

      proc.stdout.on('data', (data) => {
        const output = data.toString();
        // localtunnel prints: "your url is: https://xxx.loca.lt"
        const match = output.match(/https?:\/\/[^\s]+/);
        if (match && !resolved) {
          resolved = true;
          resolve(match[0]);
        }
      });

      proc.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output && !resolved) {
          log.debug(`localtunnel: ${output}`);
        }
      });

      proc.on('error', (err) => {
        if (!resolved) reject(new Error(`localtunnel failed to start: ${err.message}. Run: npm install -g localtunnel`));
      });

      proc.on('exit', (code) => {
        if (!resolved) reject(new Error(`localtunnel exited with code ${code}`));
        this.tunnel = null;
      });

      // Timeout after 15s
      setTimeout(() => {
        if (!resolved) {
          proc.kill();
          reject(new Error('localtunnel timed out after 15s'));
        }
      }, 15000);
    });
  }

  /**
   * Cloudflare Tunnel — free, needs cloudflared binary installed
   * Mode 1: Named tunnel with token (persistent URL — recommended)
   *   - User creates tunnel in Cloudflare Zero Trust dashboard
   *   - Gets a tunnel token, pastes into onboard
   *   - URL stays the same across restarts
   * Mode 2: Quick tunnel (random URL — no account needed, changes every restart)
   */
  async _tunnelCloudflare(port) {
    const { spawn } = await import('child_process');

    // Check for persistent tunnel token
    const tunnelToken = this.config.dashboard?.tunnelToken
      || this.qclaw.credentials?.get?.('cloudflare_tunnel_token')
      || process.env.CLOUDFLARE_TUNNEL_TOKEN;

    if (tunnelToken) {
      // Named tunnel with token — persistent URL
      log.info('Using persistent Cloudflare tunnel...');
      const args = ['tunnel', '--no-autoupdate', 'run', '--token', tunnelToken];

      return new Promise((resolve, reject) => {
        const proc = spawn('cloudflared', args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        this.tunnel = proc;
        let resolved = false;

        const handleOutput = (data) => {
          const output = data.toString();
          // Named tunnels log the URL differently
          const match = output.match(/https:\/\/[a-z0-9.-]+\.[a-z]+/);
          if (match && !resolved && !match[0].includes('api.cloudflare.com')) {
            resolved = true;
            resolve(match[0]);
          }
          // Also check for connection success message
          if (!resolved && output.includes('Registered tunnel connection')) {
            // The URL is configured in the Cloudflare dashboard, extract from config
            const savedUrl = this.config.dashboard?.tunnelUrl;
            if (savedUrl) {
              resolved = true;
              resolve(savedUrl);
            }
          }
        };

        proc.stdout.on('data', handleOutput);
        proc.stderr.on('data', handleOutput);

        proc.on('error', (err) => {
          if (!resolved) reject(new Error(`cloudflared not found: ${err.message}`));
        });

        proc.on('exit', (code) => {
          if (!resolved) reject(new Error(`cloudflared exited with code ${code}`));
          this.tunnel = null;
        });

        // Named tunnels may take longer to connect
        setTimeout(() => {
          if (!resolved) {
            // If we have a saved URL, use it (the tunnel is probably connected but didn't log the URL)
            const savedUrl = this.config.dashboard?.tunnelUrl;
            if (savedUrl) {
              resolved = true;
              resolve(savedUrl);
            } else {
              proc.kill();
              reject(new Error('cloudflared timed out after 45s — check your tunnel token'));
            }
          }
        }, 45000);
      });
    }

    // Quick tunnel (no token — random URL, changes every restart)
    log.info('Using quick Cloudflare tunnel (random URL)...');
    const args = ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'];

    return new Promise((resolve, reject) => {
      const proc = spawn('cloudflared', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.tunnel = proc;
      let resolved = false;

      const handleOutput = (data) => {
        const output = data.toString();
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          resolve(match[0]);
        }
      };

      proc.stdout.on('data', handleOutput);
      proc.stderr.on('data', handleOutput);

      proc.on('error', (err) => {
        if (!resolved) reject(new Error(`cloudflared not found: ${err.message}. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`));
      });

      proc.on('exit', (code) => {
        if (!resolved) reject(new Error(`cloudflared exited with code ${code}`));
        this.tunnel = null;
      });

      setTimeout(() => {
        if (!resolved) {
          proc.kill();
          reject(new Error('cloudflared timed out after 30s'));
        }
      }, 30000);
    });
  }

  /**
   * ngrok — paid (free tier available), most features
   * Requires ngrok binary and auth token
   */
  async _tunnelNgrok(port) {
    const { spawn } = await import('child_process');

    const args = ['http', String(port), '--log', 'stdout', '--log-format', 'json'];

    return new Promise((resolve, reject) => {
      const proc = spawn('ngrok', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.tunnel = proc;
      let resolved = false;

      proc.stdout.on('data', (data) => {
        // ngrok JSON log format
        for (const line of data.toString().split('\n').filter(Boolean)) {
          try {
            const entry = JSON.parse(line);
            if (entry.url && !resolved) {
              resolved = true;
              resolve(entry.url);
            }
            // Also check msg field for the URL
            if (entry.msg === 'started tunnel' && entry.url && !resolved) {
              resolved = true;
              resolve(entry.url);
            }
          } catch {
            // Not JSON, check raw output
            const match = line.match(/https:\/\/[a-z0-9-]+\.ngrok[^\s]*/);
            if (match && !resolved) {
              resolved = true;
              resolve(match[0]);
            }
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const output = data.toString().trim();
        if (output) log.debug(`ngrok: ${output}`);
      });

      proc.on('error', (err) => {
        if (!resolved) reject(new Error(`ngrok not found: ${err.message}. Install: https://ngrok.com/download`));
      });

      proc.on('exit', (code) => {
        if (!resolved) reject(new Error(`ngrok exited with code ${code}. Run: ngrok config add-authtoken <token>`));
        this.tunnel = null;
      });

      setTimeout(() => {
        if (!resolved) {
          proc.kill();
          reject(new Error('ngrok timed out after 15s'));
        }
      }, 15000);
    });
  }

  async _stopTunnel() {
    if (this.tunnel && this.tunnel.kill) {
      this.tunnel.kill('SIGTERM');
      this.tunnel = null;
      this.tunnelUrl = null;
    }
  }

  async _listen(host, port) {
    return new Promise((resolve, reject) => {
      const tryPort = (p) => {
        this.server.listen(p, host)
          .on('listening', () => resolve(p))
          .on('error', (err) => {
            if (err.code === 'EADDRINUSE' && this.config.dashboard?.autoPort) {
              log.debug(`Port ${p} in use, trying ${p + 1}`);
              tryPort(p + 1);
            } else {
              reject(err);
            }
          });
      };
      tryPort(port);
    });
  }
}
