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
import { setupManusWebhook } from './webhook-manus.js';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

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
    // Load .env for persistent secrets (session secret, auth token, R2 creds)
    try {
      const envPath = join(process.env.HOME || "/root", ".quantumclaw", ".env");
      if (existsSync(envPath)) {
        const envContent = readFileSync(envPath, "utf-8");
        for (const line of envContent.split("\n")) {
          const m = line.match(/^([A-Z][A-Z0-9_]+)=(.+)$/);
          if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
        }
      }
    } catch {}

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
    this.AUTH_MAX_ATTEMPTS = 10;
    this.AUTH_LOCKOUT_MS = 120000; // 2 minutes

    this.app.use('/api/upload/part', express.raw({ type: 'application/octet-stream', limit: '60mb' }));
    this.app.use(express.json({ limit: '20mb' }));
    this.app.use(express.urlencoded({ extended: false }));
    this.app.use(cookieParser());

    // Session auth secret (for JWT cookie signing)
    this.sessionSecret = process.env.DASHBOARD_SESSION_SECRET;
    if (!this.sessionSecret) {
      const { randomBytes } = await import('crypto');
      this.sessionSecret = randomBytes(32).toString('hex');
      log.warn('DASHBOARD_SESSION_SECRET not set — generated ephemeral secret (sessions won\'t persist across restarts)');
    }

    // Rate limiting on sensitive endpoints
    const { default: rateLimit } = await import('express-rate-limit');
    this.app.use('/api/trading/simulate', rateLimit({ windowMs: 60000, max: 10, message: { error: 'Too many simulation requests' } }));
    this.app.use('/api/upload/initiate', rateLimit({ windowMs: 60000, max: 10, message: { error: 'Too many upload requests' } }));
    this.app.use('/api/upload/part', rateLimit({ windowMs: 60000, max: 200, message: { error: 'Too many part uploads' } }));
    this.app.use('/api/upload/complete', rateLimit({ windowMs: 60000, max: 10, message: { error: 'Too many upload requests' } }));
    this.app.use('/api/content-studio/upload', rateLimit({ windowMs: 60000, max: 5, message: { error: 'Too many upload requests' } }));
    this.app.use('/api/content-studio/upload-image', rateLimit({ windowMs: 60000, max: 10, message: { error: 'Too many image upload requests' } }));
    this.app.use("/api/crete/generate-image", rateLimit({ windowMs: 60000, max: 10, message: { error: "Too many image generation requests" } }));
    this.app.use('/api/trading/execute', rateLimit({ windowMs: 60000, max: 5, message: { error: 'Too many trade requests' } }));

    // Serve agency character assets
    this.app.use('/agency-assets', express.static(join(__dirname, 'agency-assets')));

    // API routes
    this._setupAPI();

    // Manus webhook handler
    try { setupManusWebhook(this); } catch (err) { log.debug(`Manus webhook: ${err.message}`); }

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

    // Login page
    this.app.get('/login', (req, res) => {
      const error = req.query.error === '1';
      res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard — Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{width:100%;max-width:360px;padding:40px}
h1{font-size:1.1rem;font-weight:600;margin-bottom:24px;letter-spacing:-.01em}
.subtle{color:#888;font-size:.8rem;margin-bottom:20px}
input[type=password]{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-size:.9rem;outline:none;transition:border .15s}
input[type=password]:focus{border-color:#333}
button{width:100%;padding:10px;margin-top:12px;background:#1a1a1a;color:#fff;border:none;border-radius:6px;font-size:.9rem;cursor:pointer;transition:opacity .15s}
button:hover{opacity:.85}
.err{color:#d33;font-size:.8rem;margin-top:8px}
</style></head><body>
<div class="card">
<h1>Agent Boardroom</h1>
<p class="subtle">Enter your dashboard token to continue.</p>
<form method="POST" action="/api/auth/login">
<input type="password" name="password" placeholder="Token" autofocus required>
<button type="submit">Sign in</button>
${error ? '<p class="err">Invalid token. Please try again.</p>' : ''}
</form></div></body></html>`);
    });

    // Login endpoint
    this.app.post('/api/auth/login', (req, res) => {
      const ip = req.ip || req.socket.remoteAddress;

      // Check lockout
      const lockout = this.authAttempts.get(ip);
      if (lockout?.lockedUntil && Date.now() < lockout.lockedUntil) {
        return res.redirect('/login?error=1');
      }

      const password = req.body?.password;
      const authToken = this.config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN;

      if (password && authToken && password === authToken) {
        // Success — issue JWT cookie
        const token = jwt.sign({ authenticated: true }, this.sessionSecret, { expiresIn: '24h' });
        res.cookie('dashboard_session', token, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          maxAge: 86400000, // 24h
        });
        this.authAttempts.delete(ip);
        return res.redirect('/');
      }

      // Failed — track attempt
      const attempts = this.authAttempts.get(ip) || { count: 0 };
      attempts.count++;
      if (attempts.count >= this.AUTH_MAX_ATTEMPTS) {
        attempts.lockedUntil = Date.now() + this.AUTH_LOCKOUT_MS;
        log.warn(`Dashboard login lockout: ${ip} (${this.AUTH_MAX_ATTEMPTS} failed attempts)`);
      }
      this.authAttempts.set(ip, attempts);
      return res.redirect('/login?error=1');
    });

    // Logout endpoint
    this.app.get('/api/auth/logout', (req, res) => {
      res.clearCookie('dashboard_session');
      res.redirect('/login');
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

    // Find available port
    const actualPort = await this._listen(host, port);
    this.actualPort = actualPort;

    // WebSocket for real-time chat (initialise after successful bind)
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.wss.on('error', (err) => {
      log.warn(`Dashboard WebSocket error: ${err.message}`);
    });
    this._setupWebSocket();

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
      // Skip auth for public paths
      const publicPaths = ['/', '/login', '/onboard', '/favicon.ico',
        '/api/health', '/api/auth/verify-pin', '/api/auth/login', '/api/auth/logout'];
      if (publicPaths.includes(req.path)) return next();

      const ip = req.ip || req.socket.remoteAddress;
      const isLocalhost = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
      const isBrowser = (req.headers.accept || '').includes('text/html');

      // Check auth lockout
      const lockout = this.authAttempts.get(ip);
      if (!isLocalhost && lockout?.lockedUntil && Date.now() < lockout.lockedUntil) {
        const remaining = Math.ceil((lockout.lockedUntil - Date.now()) / 60000);
        return res.status(429).json({ error: `Locked out. Try again in ${remaining} minutes.` });
      }

      const authToken = this.config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN;
      let authenticated = false;

      // Priority 1: JWT session cookie
      const sessionCookie = req.cookies?.dashboard_session;
      if (sessionCookie) {
        try {
          jwt.verify(sessionCookie, this.sessionSecret);
          authenticated = true;
        } catch {
          // Cookie expired or invalid — clear it
          res.clearCookie('dashboard_session');
        }
      }

      // Priority 2: Bearer token header (API/programmatic access)
      if (!authenticated && authToken) {
        const bearer = req.headers['authorization']?.replace('Bearer ', '');
        if (bearer && bearer === authToken) {
          authenticated = true;
        }
      }

      // Priority 3: ?token= query param (API/programmatic access)
      if (!authenticated && authToken && req.query.token) {
        if (req.query.token === authToken) {
          authenticated = true;
        }
      }

      if (!authenticated) {
        if (!isLocalhost) {
          // Track failed attempt for non-localhost
          const attempts = this.authAttempts.get(ip) || { count: 0 };
          attempts.count++;
          if (attempts.count >= this.AUTH_MAX_ATTEMPTS) {
            attempts.lockedUntil = Date.now() + this.AUTH_LOCKOUT_MS;
            log.warn(`Dashboard auth lockout: ${ip} (${this.AUTH_MAX_ATTEMPTS} failed attempts)`);
          }
          this.authAttempts.set(ip, attempts);
        }
        return isBrowser ? res.redirect('/login') : res.status(401).json({ error: 'Unauthorised' });
      }

      // Token expiry check — only for auto-generated session tokens, not the static config authToken
      // Skip for: cookie sessions, localhost, and when a persistent authToken is set in config
      const isAutoToken = !this.config.dashboard?.authToken;
      if (!sessionCookie && !isLocalhost && isAutoToken && this.tokenCreatedAt && this.tokenExpiry) {
        if (Date.now() - this.tokenCreatedAt > this.tokenExpiry) {
          return isBrowser
            ? res.redirect('/login')
            : res.status(401).json({ error: 'Token expired. Run: qclaw dashboard' });
        }
      }

      // Reset failed attempts on success
      this.authAttempts.delete(ip);

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

    // Cost breakdown by channel
    this.app.get('/api/costs/by-channel', (req, res) => {
      const period = req.query.period || 'today';
      res.json(this.qclaw.audit.costsByChannel(period));
    });

    // Currency conversion for dashboard costs
    this.app.get('/api/costs/convert', async (req, res) => {
      try {
        const currency = String(req.query.currency || 'GBP').toUpperCase();
        const period = String(req.query.period || 'today').toLowerCase();

        const summary = this.qclaw.audit.costSummary();
        const periodKey = period === 'week' ? 'week' : period === 'month' ? 'month' : 'today';
        const sourceAmount = Number(summary[periodKey] || 0);

        const mod = await import('../security/currency-rates.js');
        const converter = mod.default || mod;
        const converted = await converter.convert(sourceAmount, currency);

        res.json({
          period: periodKey,
          source_currency: 'GBP',
          target_currency: currency,
          source_amount: sourceAmount,
          converted_amount: converted
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Supported conversion currencies
    this.app.get('/api/currencies', async (req, res) => {
      try {
        const mod = await import('../security/currency-rates.js');
        const converter = mod.default || mod;
        res.json({ currencies: converter.getSupportedCurrencies() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Spike detection check
    this.app.get('/api/alerts/check', async (req, res) => {
      try {
        const period = String(req.query.period || 'hour').toLowerCase();
        const validPeriods = new Set(['hour', 'day', 'week']);
        const selected = validPeriods.has(period) ? period : 'hour';

        // Build a windowed cost provider for SpikeDetector.
        const costProvider = {
          getCosts: async (start, end) => {
            const rows = this.qclaw.audit.recent(5000);
            const inWindow = rows.filter(r => {
              const t = new Date(r.timestamp).getTime();
              return Number.isFinite(t) && t >= start && t < end && r.action === 'completion';
            });
            return {
              total: inWindow.reduce((sum, r) => sum + (Number(r.cost) || 0), 0),
              messages: inWindow.length
            };
          }
        };

        const mod = await import('../security/spike-detector.js');
        const SpikeDetector = mod.default || mod;
        const detector = new SpikeDetector(costProvider);
        const result = await detector.detectSpikes(selected);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Recent spike alerts
    this.app.get('/api/alerts', async (req, res) => {
      try {
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
        const mod = await import('../security/spike-detector.js');
        const SpikeDetector = mod.default || mod;
        const detector = new SpikeDetector({ getCosts: async () => ({ total: 0, messages: 0 }) });
        const alerts = await detector.getRecentAlerts(limit);
        res.json({ alerts });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
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
          isPrimary: agent.name === this.qclaw.agents.primary()?.name,
          aidId: agent.aid?.aid_id || null,
          trustTier: agent.aid?.trust_tier ?? null
        });
      }
      res.json(agents);
    });

    // ─── AGEX Status ────────────────────────────────────────
    this.app.get('/api/agex/status', (req, res) => {
      const status = this.qclaw.credentials?.status?.() || { mode: 'local' };

      // Enrich with per-agent AIDs
      const agentAids = [];
      for (const name of this.qclaw.agents.list()) {
        const agent = this.qclaw.agents.get(name);
        agentAids.push({
          name: agent.name,
          aidId: agent.aid?.aid_id || null,
          trustTier: agent.aid?.trust_tier || null,
          isPrimary: agent.name === this.qclaw.agents.primary()?.name
        });
      }

      res.json({ ...status, agents: agentAids });
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
      // Deep-copy dashboard to avoid mutating the live config object
      if (safe.dashboard) {
        safe.dashboard = { ...safe.dashboard };
        if (safe.dashboard.authToken) safe.dashboard.authToken = '***';
        if (safe.dashboard.pin) safe.dashboard.pin = '***';
        if (safe.dashboard.tunnelToken) safe.dashboard.tunnelToken = '***';
      }
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

    // ─── Secrets Management ─────────────────────────────────
    this.app.get('/api/secrets', (req, res) => {
      const secrets = this.qclaw.credentials;
      if (!secrets?.list) return res.json([]);
      const keys = secrets.list();
      res.json(keys.map(k => ({ key: k, set: true })));
    });

    this.app.post('/api/secrets', async (req, res) => {
      try {
        const { key, value } = req.body;
        if (!key) return res.status(400).json({ error: 'key required' });
        if (!value) return res.status(400).json({ error: 'value required' });
        const secrets = this.qclaw.credentials;
        if (!secrets?.set) return res.status(500).json({ error: 'SecretStore not available' });
        secrets.set(key, value);
        res.json({ ok: true, key });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    this.app.delete('/api/secrets/:key', async (req, res) => {
      try {
        const { key } = req.params;
        const secrets = this.qclaw.credentials;
        if (!secrets?.delete) return res.status(500).json({ error: 'SecretStore not available' });
        secrets.delete(key);
        res.json({ ok: true, key });
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

    // ─── Tools Management ────────────────────────────────────
    this.app.get('/api/tools', (req, res) => {
      try {
        const tools = this.qclaw.tools?.listTools?.() || [];
        res.json(tools);
      } catch { res.json([]); }
    });

    this.app.get('/api/tools/log', (req, res) => {
      try {
        const logs = this.qclaw.audit?.recent?.(50)?.filter(e => e.action === 'tool') || [];
        res.json(logs);
      } catch { res.json([]); }
    });

    // ─── Agent Management (delete + SOUL editor) ────────────
    this.app.delete('/api/agents/:name', async (req, res) => {
      try {
        const name = req.params.name;
        const { rmSync, existsSync } = await import('fs');
        const agentDir = join(this.qclaw.config._dir, 'workspace', 'agents', name);
        if (!existsSync(agentDir)) return res.status(404).json({ error: 'Agent not found' });
        rmSync(agentDir, { recursive: true, force: true });
        if (this.qclaw.agents?.agents) this.qclaw.agents.agents.delete(name);
        res.json({ ok: true, message: `Agent "${name}" deleted` });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    this.app.get('/api/agents/:name/soul', async (req, res) => {
      try {
        const name = req.params.name;
        const { readFileSync, existsSync } = await import('fs');
        const soulPath = join(this.qclaw.config._dir, 'workspace', 'agents', name, 'SOUL.md');
        if (!existsSync(soulPath)) return res.status(404).json({ error: 'SOUL.md not found' });
        res.json({ content: readFileSync(soulPath, 'utf-8') });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    this.app.put('/api/agents/:name/soul', async (req, res) => {
      try {
        const name = req.params.name;
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: 'content required' });
        const { writeFileSync, existsSync, lstatSync } = await import('fs');
        const soulPath = join(this.qclaw.config._dir, 'workspace', 'agents', name, 'SOUL.md');
        if (!existsSync(join(this.qclaw.config._dir, 'workspace', 'agents', name))) {
          return res.status(404).json({ error: 'Agent not found' });
        }
        // Refuse to write through a symlink — those targets are canonicalized to the repo.
        const lstat = lstatSync(soulPath, { throwIfNoEntry: false });
        if (lstat?.isSymbolicLink()) {
          return res.status(409).json({ error: 'This identity file is canonicalized to the repo. Edit via git.' });
        }
        writeFileSync(soulPath, content);
        res.json({ ok: true, message: 'SOUL.md updated. Restart agent to apply.' });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Knowledge Graph Visualization ──────────────────────
    this.app.get('/api/memory/graph', async (req, res) => {
      try {
        if (!this.qclaw.memory?.getGraph) return res.json({ nodes: [], edges: [] });
        const graph = await this.qclaw.memory.getGraph();
        res.json(graph);
      } catch (err) { res.json({ nodes: [], edges: [], error: err.message }); }
    });

    this.app.post('/api/memory/remember', async (req, res) => {
      try {
        const { fact } = req.body;
        if (!fact) return res.status(400).json({ error: 'fact required' });
        if (this.qclaw.memory?.knowledge) {
          this.qclaw.memory.knowledge.add('semantic', fact, { source: 'dashboard', confidence: 1.0 });
          res.json({ ok: true });
        } else {
          res.status(500).json({ error: 'Knowledge store not initialized' });
        }
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    this.app.get('/api/memory/export', async (req, res) => {
      try {
        const knowledge = this.qclaw.memory?.knowledge;
        if (!knowledge) return res.json({ semantic: [], episodic: [], procedural: [] });
        res.json({
          semantic: knowledge.getByType('semantic', 500),
          episodic: knowledge.getByType('episodic', 500),
          procedural: knowledge.getByType('procedural', 500),
          stats: knowledge.stats(),
          exportedAt: new Date().toISOString(),
        });
      } catch (err) { res.json({ error: err.message }); }
    });

    // ─── Cognee Memory Search Proxy ──────────────────────────
    this.app.post('/api/memory/cognee-search', async (req, res) => {
      try {
        const { query } = req.body;
        if (!query) return res.status(400).json({ error: 'query required' });
        const cogneeRes = await fetch('http://localhost:8000/api/v1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await cogneeRes.json();
        res.json(data);
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Live Canvas ──────────────────────────────────────────
    this.app.post('/api/canvas/render', (req, res) => {
      try {
        const { format, title, content, id } = req.body;
        if (!content) return res.status(400).json({ error: 'content required' });
        const validFormats = ['html', 'markdown', 'mermaid', 'svg', 'image', 'text'];
        const fmt = validFormats.includes(format) ? format : 'html';
        this.broadcast({
          type: 'canvas_render',
          format: fmt,
          title: title || 'Artifact',
          content,
          id: id || `canvas-${Date.now()}`,
        });
        res.json({ ok: true, format: fmt });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Content Studio: R2 Multipart Upload (large files) ───────
    // Helper: load R2 credentials from .env
    const _loadR2Creds = async () => {
      const envPath = join(process.env.HOME || '/root', '.quantumclaw', '.env');
      const envVars = {};
      const envContent = (await import('fs')).readFileSync(envPath, 'utf-8');
      for (const line of envContent.split('\n')) {
        const match = line.match(/^([A-Z0-9_]+)=(.+)$/);
        if (match) envVars[match[1]] = match[2];
      }
      const accountId = envVars.R2_ACCOUNT_ID;
      const accessKeyId = envVars.R2_ACCESS_KEY_ID;
      const secretAccessKey = envVars.R2_SECRET_ACCESS_KEY;
      const bucket = envVars.R2_BUCKET_NAME || 'emma-content-studio';
      if (!accountId || !accessKeyId || !secretAccessKey) throw new Error('R2 credentials not configured');
      const { S3Client } = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey }
      });
      return { s3, bucket };
    };

    // 1. Initiate multipart upload
    this.app.post('/api/upload/initiate', async (req, res) => {
      try {
        const { filename, contentType, fileSize } = req.body;
        if (!filename) return res.status(400).json({ error: 'filename required' });
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `episodes/${Date.now()}-${safeName}`;
        const { s3, bucket } = await _loadR2Creds();
        const { CreateMultipartUploadCommand } = await import('@aws-sdk/client-s3');
        const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType || 'video/mp4'
        }));
        res.json({ uploadId: UploadId, key });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // 2. Upload a single part (receives raw binary with headers)
    this.app.post('/api/upload/part', async (req, res) => {
      try {
        const uploadId = req.headers['x-upload-id'];
        const key = req.headers['x-upload-key'];
        const partNumber = parseInt(req.headers['x-part-number'], 10);
        if (!uploadId || !key || !partNumber) {
          return res.status(400).json({ error: 'x-upload-id, x-upload-key, x-part-number headers required' });
        }
        const { s3, bucket } = await _loadR2Creds();
        const { UploadPartCommand } = await import('@aws-sdk/client-s3');
        const { ETag } = await s3.send(new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: req.body
        }));
        res.json({ ETag, partNumber });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // 3. Complete multipart upload
    this.app.post('/api/upload/complete', async (req, res) => {
      try {
        const { uploadId, key, parts } = req.body;
        if (!uploadId || !key || !parts?.length) {
          return res.status(400).json({ error: 'uploadId, key, and parts[] required' });
        }
        const { s3, bucket } = await _loadR2Creds();
        const { CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');
        await s3.send(new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map(p => ({ ETag: p.ETag, PartNumber: p.PartNumber })) }
        }));
        const publicUrl = `https://pub-70c436931e9e4611a135e7405c596611.r2.dev/${key}`;
        res.json({ publicUrl, r2FileKey: key });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Content Studio: R2 Upload ─────────────────────────────
    this.app.post('/api/content-studio/upload', async (req, res) => {
      try {
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const { default: Busboy } = await import('busboy');

        const envPath = join(process.env.HOME || '/root', '.quantumclaw', '.env');
        const envVars = {};
        try {
          const envContent = (await import('fs')).readFileSync(envPath, 'utf-8');
          for (const line of envContent.split('\n')) {
            const match = line.match(/^([A-Z0-9_]+)=(.+)$/);
            if (match) envVars[match[1]] = match[2];
          }
        } catch { return res.status(500).json({ error: 'Could not read R2 credentials' }); }

        const accountId = envVars.R2_ACCOUNT_ID;
        const accessKeyId = envVars.R2_ACCESS_KEY_ID;
        const secretAccessKey = envVars.R2_SECRET_ACCESS_KEY;
        const bucket = envVars.R2_BUCKET_NAME || 'emma-content-studio';

        if (!accountId || !accessKeyId || !secretAccessKey) {
          return res.status(500).json({ error: 'R2 credentials not configured in .env' });
        }

        const s3 = new S3Client({
          region: 'auto',
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId, secretAccessKey }
        });

        const bb = Busboy({ headers: req.headers, limits: { fileSize: 500 * 1024 * 1024 } });
        let fileKey = null;
        let uploadPromise = null;

        bb.on('file', (fieldname, stream, info) => {
          const filename = info.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
          fileKey = `episodes/${Date.now()}-${filename}`;
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            const body = Buffer.concat(chunks);
            uploadPromise = s3.send(new PutObjectCommand({
              Bucket: bucket,
              Key: fileKey,
              Body: body,
              ContentType: info.mimeType || 'video/mp4'
            }));
          });
        });

        bb.on('finish', async () => {
          if (!uploadPromise || !fileKey) {
            return res.status(400).json({ error: 'No file received' });
          }
          try {
            await uploadPromise;
            const publicUrl = `https://pub-70c436931e9e4611a135e7405c596611.r2.dev/${fileKey}`;
            res.json({ r2FileKey: fileKey, r2Url: publicUrl, publicUrl });
          } catch (err) {
            res.status(500).json({ error: 'R2 upload failed: ' + err.message });
          }
        });

        bb.on('error', (err) => {
          res.status(500).json({ error: 'Upload parse error: ' + err.message });
        });

        req.pipe(bb);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── Content Studio: Image Upload ──────────────────────────
    this.app.post('/api/content-studio/upload-image', async (req, res) => {
      try {
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const { default: Busboy } = await import('busboy');
        const { default: sharp } = await import('sharp');

        const envPath = join(process.env.HOME || '/root', '.quantumclaw', '.env');
        const envVars = {};
        try {
          const envContent = (await import('fs')).readFileSync(envPath, 'utf-8');
          for (const line of envContent.split('\n')) {
            const match = line.match(/^([A-Z0-9_]+)=(.+)$/);
            if (match) envVars[match[1]] = match[2];
          }
        } catch { return res.status(500).json({ error: 'Could not read R2 credentials' }); }

        const accountId = envVars.R2_ACCOUNT_ID;
        const accessKeyId = envVars.R2_ACCESS_KEY_ID;
        const secretAccessKey = envVars.R2_SECRET_ACCESS_KEY;
        const bucket = envVars.R2_BUCKET_NAME || 'emma-content-studio';

        if (!accountId || !accessKeyId || !secretAccessKey) {
          return res.status(500).json({ error: 'R2 credentials not configured' });
        }

        const s3 = new S3Client({
          region: 'auto',
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId, secretAccessKey }
        });

        const bb = Busboy({ headers: req.headers, limits: { fileSize: 20 * 1024 * 1024 } });
        const fields = {};
        let fileBuffer = null;

        bb.on('field', (name, val) => { fields[name] = val; });
        bb.on('file', (fieldname, stream) => {
          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
        });

        bb.on('finish', async () => {
          if (!fileBuffer) return res.status(400).json({ error: 'No file received' });

          const { jobId, imageType } = fields;
          if (!jobId || !imageType) return res.status(400).json({ error: 'jobId and imageType required' });
          if (!['hero', 'thumbnail'].includes(imageType)) return res.status(400).json({ error: 'imageType must be hero or thumbnail' });

          try {
            const dims = imageType === 'hero' ? { w: 1200, h: 628 } : { w: 1280, h: 720 };
            const resized = await sharp(fileBuffer)
              .resize(dims.w, dims.h, { fit: 'cover' })
              .jpeg({ quality: 85 })
              .toBuffer();

            const fileKey = `episodes/${jobId}/${imageType}.jpg`;
            await s3.send(new PutObjectCommand({
              Bucket: bucket,
              Key: fileKey,
              Body: resized,
              ContentType: 'image/jpeg'
            }));

            const publicUrl = `https://pub-70c436931e9e4611a135e7405c596611.r2.dev/${fileKey}`;

            // Update Supabase job record
            const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
            const col = imageType === 'hero' ? 'hero_image_url' : 'thumbnail_url';
            await fetch(`https://fdabygmromuqtysitodp.supabase.co/rest/v1/content_studio_jobs?id=eq.${encodeURIComponent(jobId)}`, {
              method: 'PATCH',
              headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ [col]: publicUrl })
            });

            res.json({ url: publicUrl });
          } catch (err) {
            res.status(500).json({ error: 'Image processing failed: ' + err.message });
          }
        });

        bb.on('error', (err) => res.status(500).json({ error: 'Upload parse error: ' + err.message }));
        req.pipe(bb);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── Content Studio: Schedule Clip ──────────────────────────
    this.app.post('/api/content-studio/schedule-clip', async (req, res) => {
      try {
        const { clipUrl, caption, platform, scheduledAt, jobId } = req.body;
        if (!clipUrl || !platform || !jobId) {
          return res.status(400).json({ error: 'clipUrl, platform, and jobId are required' });
        }
        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
        const sbRes = await fetch('https://fdabygmromuqtysitodp.supabase.co/rest/v1/social_clip_schedules', {
          method: 'POST',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify({ clip_url: clipUrl, caption: caption || '', platform, scheduled_at: scheduledAt || null, job_id: jobId })
        });
        const data = await sbRes.json();
        if (!sbRes.ok) return res.status(sbRes.status).json({ error: data.message || 'Failed to save schedule' });
        res.json({ ok: true, schedule: Array.isArray(data) ? data[0] : data });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // ─── Content Studio: Jobs ─────────────────────────────────
    this.app.get('/api/content-studio/jobs', async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
        const sbRes = await fetch(`https://fdabygmromuqtysitodp.supabase.co/rest/v1/content_studio_jobs?order=created_at.desc&limit=${limit}`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
        });
        res.json(await sbRes.json());
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    this.app.get('/api/content-studio/jobs/:id', async (req, res) => {
      try {
        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
        const sbRes = await fetch(`https://fdabygmromuqtysitodp.supabase.co/rest/v1/content_studio_jobs?id=eq.${encodeURIComponent(req.params.id)}`, {
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
        });
        const rows = await sbRes.json();
        if (!rows.length) return res.status(404).json({ error: 'Job not found' });
        res.json(rows[0]);
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Trading: Balance & PnL ───────────────────────────────
    this.app.get('/api/trading/balance', async (req, res) => {
      try {
        const { execSync } = await import('child_process');

        let usdcBalance = 0;
        try {
          const result = execSync('python3 /root/QClaw/src/trading/get_balance.py', { timeout: 10000 }).toString();
          const { balance } = JSON.parse(result);
          usdcBalance = balance;
        } catch { usdcBalance = 0; }

        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
        const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

        const [closedRes, openRes] = await Promise.all([
          fetch('https://fdabygmromuqtysitodp.supabase.co/rest/v1/trading_positions?status=eq.closed&select=pnl', { headers }),
          fetch('https://fdabygmromuqtysitodp.supabase.co/rest/v1/trading_positions?status=eq.open&select=id', { headers })
        ]);
        const closedRows = await closedRes.json();
        const openRows = await openRes.json();

        const realisedPnl = Array.isArray(closedRows) ? closedRows.reduce((sum, r) => sum + (parseFloat(r.pnl) || 0), 0) : 0;
        const openPositions = Array.isArray(openRows) ? openRows.length : 0;

        res.json({ usdc_balance: Math.round(usdcBalance * 100) / 100, realised_pnl: Math.round(realisedPnl * 100) / 100, open_positions: openPositions });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Trading: Simulate (proxy to Monte Carlo worker) ─────
    this.app.post('/api/trading/simulate', async (req, res) => {
      try {
        const mcRes = await fetch('http://localhost:4001/simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body)
        });
        const data = await mcRes.json();
        if (!mcRes.ok) return res.status(mcRes.status).json(data);

        // Save simulation to Supabase
        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
        await fetch('https://fdabygmromuqtysitodp.supabase.co/rest/v1/trading_simulations', {
          method: 'POST',
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            asset: data.asset, question: data.question, target: data.target,
            probability: data.probability, confidence_lower: data.confidence_lower,
            confidence_upper: data.confidence_upper, current_price: data.current_price,
            macro_factors: data.macro_factors, macro_adjustment: data.macro_adjustment
          })
        }).catch(() => {});

        res.json(data);
      } catch (err) { res.status(502).json({ error: 'Monte Carlo worker unavailable: ' + err.message }); }
    });

    // ─── Trading: Execute Trade (called by n8n) ──────────────
    this.app.post('/api/trading/execute', async (req, res) => {
      try {
        const { market_id, direction, amount } = req.body;
        if (!market_id || !direction || !amount) {
          return res.status(400).json({ error: 'market_id, direction, and amount required' });
        }
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const cmd = `python3 /root/QClaw/src/trading/execute_trade.py --market ${market_id} --direction ${direction} --amount ${amount}`;
        const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
        const result = JSON.parse(stdout);
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message, stderr: err.stderr || '' });
      }
    });

    // ─── Trading: Positions ─────────────────────────────────
    this.app.get('/api/trading/positions', async (req, res) => {
      try {
        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
        const sbRes = await fetch('https://fdabygmromuqtysitodp.supabase.co/rest/v1/trading_positions?status=eq.open&order=created_at.desc&limit=50', {
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
        });
        res.json(await sbRes.json());
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Trading: Simulations ───────────────────────────────
    this.app.get('/api/trading/simulations', async (req, res) => {
      try {
        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
        const sbRes = await fetch('https://fdabygmromuqtysitodp.supabase.co/rest/v1/trading_simulations?select=asset,probability,current_price,macro_factors,created_at&order=created_at.desc&limit=10', {
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
        });
        res.json(await sbRes.json());
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Trading: Config ────────────────────────────────────
    this.app.get('/api/trading/config', async (req, res) => {
      try {
        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
        const sbRes = await fetch('https://fdabygmromuqtysitodp.supabase.co/rest/v1/trading_config?id=eq.1&select=*', {
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
        });
        const rows = await sbRes.json();
        res.json(rows[0] || { trading_enabled: false, max_position_usdc: 25, min_edge_threshold: 25, daily_loss_limit: 50 });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    this.app.post('/api/trading/config', async (req, res) => {
      try {
        const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk';
        const { trading_enabled, max_position_usdc, min_edge_threshold, daily_loss_limit } = req.body;
        // Upsert config (single row)
        const sbRes = await fetch('https://fdabygmromuqtysitodp.supabase.co/rest/v1/trading_config?id=eq.1', {
          method: 'PATCH',
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify({ trading_enabled, max_position_usdc, min_edge_threshold, daily_loss_limit })
        });
        const result = await sbRes.json();
        if (!Array.isArray(result) || !result.length) {
          // Insert if no row exists
          await fetch('https://fdabygmromuqtysitodp.supabase.co/rest/v1/trading_config', {
            method: 'POST',
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 1, trading_enabled, max_position_usdc, min_edge_threshold, daily_loss_limit })
          });
        }
        res.json({ ok: true });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Voice Status ────────────────────────────────────────
    this.app.get('/api/voice/status', async (req, res) => {
      try {
        const { VoiceEngine } = await import('../core/voice.js');
        const voice = new VoiceEngine(this.qclaw.credentials);
        const status = await voice.status();
        res.json(status);
      } catch { res.json({ stt: [], tts: [], ready: false }); }
    });

    // ─── Proactive Push ──────────────────────────────────────
    this.app.post('/api/push', async (req, res) => {
      try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'message required' });
        if (!this.qclaw.heartbeat?.pushToUser) {
          return res.status(500).json({ error: 'Heartbeat not initialized' });
        }
        const sent = await this.qclaw.heartbeat.pushToUser(message, { source: 'dashboard' });
        res.json({ ok: true, sent });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Scheduled Tasks ────────────────────────────────────
    this.app.get('/api/scheduled', (req, res) => {
      const tasks = this.qclaw.config.heartbeat?.scheduled || [];
      res.json(tasks);
    });

    this.app.post('/api/scheduled', async (req, res) => {
      try {
        const { name, prompt, schedule, notify, agent, channel, userId } = req.body;
        if (!prompt || !schedule) return res.status(400).json({ error: 'prompt and schedule required' });
        if (!this.qclaw.config.heartbeat) this.qclaw.config.heartbeat = {};
        if (!this.qclaw.config.heartbeat.scheduled) this.qclaw.config.heartbeat.scheduled = [];
        const task = { name: name || prompt.slice(0, 30), prompt, schedule, notify: notify !== false, agent: agent || null, channel: channel || null, userId: userId || null };
        this.qclaw.config.heartbeat.scheduled.push(task);
        const { saveConfig } = await import('../core/config.js');
        saveConfig(this.qclaw.config);
        res.json({ ok: true, task, message: 'Task saved. Restart agent to activate.' });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    this.app.delete('/api/scheduled/:index', async (req, res) => {
      try {
        const idx = parseInt(req.params.index);
        const tasks = this.qclaw.config.heartbeat?.scheduled || [];
        if (idx < 0 || idx >= tasks.length) return res.status(404).json({ error: 'Task not found' });
        tasks.splice(idx, 1);
        const { saveConfig } = await import('../core/config.js');
        saveConfig(this.qclaw.config);
        res.json({ ok: true, message: 'Task removed. Restart agent to apply.' });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── Crete Marketing: Content Review Queue ───────────────
    // Load Supabase config from /root/.quantumclaw/.env (dotenv is not
    // auto-loaded at boot, so we parse it once here instead of hardcoding).
    const creteEnv = (() => {
      try {
        const envFile = readFileSync('/root/.quantumclaw/.env', 'utf-8');
        const out = {};
        for (const line of envFile.split('\n')) {
          const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
          if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
        }
        return out;
      } catch { return {}; }
    })();
    const CRETE_SUPABASE_URL = creteEnv.SUPABASE_URL || '';
    const CRETE_SUPABASE_KEY = creteEnv.SUPABASE_ANON_KEY || '';
    const CRETE_TABLE = `${CRETE_SUPABASE_URL}/rest/v1/crete_content_queue`;
    const CRETE_N8N_BASE = 'https://webhook.flowos.tech/webhook';
    if (!CRETE_SUPABASE_URL || !CRETE_SUPABASE_KEY) {
      log.warn('[CRETE] SUPABASE_URL or SUPABASE_ANON_KEY missing in /root/.quantumclaw/.env — Crete routes will 500');
    }

    const creteHeaders = (extra = {}) => ({
      apikey: CRETE_SUPABASE_KEY,
      Authorization: `Bearer ${CRETE_SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...extra
    });

    const CRETE_VALID_STATUSES = ['pending_review', 'approved', 'rejected', 'published', 'failed'];
    const CRETE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const creteValidUuid = (s) => typeof s === 'string' && CRETE_UUID_RE.test(s);
    const creteConfigured = () => Boolean(CRETE_SUPABASE_URL && CRETE_SUPABASE_KEY);

    // Fire-and-forget n8n webhook — never blocks the response, never throws.
    const creteFireWebhook = (name, payload) => {
      fetch(`${CRETE_N8N_BASE}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => {
        if (!r.ok) log.warn(`[CRETE] n8n webhook ${name} returned ${r.status}`);
      }).catch(err => {
        log.warn(`[CRETE] n8n webhook ${name} failed: ${err.message}`);
      });
    };

    // Telegram notify via the running qclaw telegram channel. Swallows errors.
    const creteNotifyTelegram = async (text) => {
      try {
        const tg = this.qclaw.channels?.channels?.find(c => c.constructor.name.includes('Telegram'));
        if (tg?.sendMessage) {
          await tg.sendMessage(text, { parse_mode: 'Markdown' });
        }
      } catch (err) {
        log.warn(`[CRETE] Telegram notify failed: ${err.message}`);
      }
    };

    // GET /api/crete/content — list queue (filter by status, paginated)
    this.app.get('/api/crete/content', async (req, res) => {
      try {
        if (!creteConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const params = new URLSearchParams({
          order: 'generated_at.desc',
          limit: String(limit),
          offset: String(offset)
        });
        if (req.query.status && CRETE_VALID_STATUSES.includes(req.query.status)) {
          params.set('status', `eq.${req.query.status}`);
        }
        const r = await fetch(`${CRETE_TABLE}?${params}`, { headers: creteHeaders() });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || 'Supabase error' });
        res.json({ items: data, limit, offset });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // GET /api/crete/content/:id
    this.app.get('/api/crete/content/:id', async (req, res) => {
      try {
        if (!creteConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const r = await fetch(`${CRETE_TABLE}?id=eq.${req.params.id}`, { headers: creteHeaders() });
        const rows = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: rows.message || 'Supabase error' });
        if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // POST /api/crete/content — insert new item (used by generation cron + test seeding)
    this.app.post('/api/crete/content', async (req, res) => {
      try {
        if (!creteConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        const { content_type, platform, title, body, cta, media_url, theme, scheduled_for, generation_prompt, metadata } = req.body || {};
        if (!content_type || !platform || !title || !body) {
          return res.status(400).json({ error: 'content_type, platform, title, body are required' });
        }
        const row = {
          status: 'pending_review',
          content_type, platform, title, body,
          cta: cta || null,
          media_url: media_url || null,
          theme: theme || null,
          scheduled_for: scheduled_for || null,
          generation_prompt: generation_prompt || null,
          metadata: metadata || {}
        };
        const r = await fetch(CRETE_TABLE, {
          method: 'POST',
          headers: creteHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify(row)
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || 'Supabase error' });
        const item = Array.isArray(data) ? data[0] : data;
        creteNotifyTelegram(`🆕 *New Crete content for review*\n${item.title}\n_${item.content_type}_\nReview at agentboardroom.flowos.tech`);
        res.json({ ok: true, item });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // PUT /api/crete/content/:id — edit fields before approval
    this.app.put('/api/crete/content/:id', async (req, res) => {
      try {
        if (!creteConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const allowed = ['title', 'body', 'cta', 'media_url', 'theme', 'scheduled_for', 'metadata'];
        const patch = {};
        for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No editable fields provided' });
        patch.updated_at = new Date().toISOString();
        const r = await fetch(`${CRETE_TABLE}?id=eq.${req.params.id}`, {
          method: 'PATCH',
          headers: creteHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify(patch)
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || 'Supabase error' });
        res.json({ ok: true, item: Array.isArray(data) ? data[0] : data });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // PUT /api/crete/content/:id/approve
    this.app.put('/api/crete/content/:id/approve', async (req, res) => {
      try {
        if (!creteConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const now = new Date().toISOString();
        const patch = { status: 'approved', reviewed_at: now, updated_at: now };
        const r = await fetch(`${CRETE_TABLE}?id=eq.${req.params.id}`, {
          method: 'PATCH',
          headers: creteHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify(patch)
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || 'Supabase error' });
        const item = Array.isArray(data) ? data[0] : data;
        const scheduledFor = item && item.scheduled_for ? new Date(item.scheduled_for) : null;
        const dueNow = !scheduledFor || isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now();
        if (dueNow) {
          creteFireWebhook('crete-content-publish', { content_id: req.params.id, action: 'publish' });
        }
        res.json({ ok: true, item, scheduled: !dueNow });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // PUT /api/crete/content/:id/reject
    this.app.put('/api/crete/content/:id/reject', async (req, res) => {
      try {
        if (!creteConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 2000) : '';
        const now = new Date().toISOString();
        const patch = { status: 'rejected', reviewer_notes: notes, reviewed_at: now, updated_at: now };
        const r = await fetch(`${CRETE_TABLE}?id=eq.${req.params.id}`, {
          method: 'PATCH',
          headers: creteHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify(patch)
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || 'Supabase error' });
        const item = Array.isArray(data) ? data[0] : data;
        creteFireWebhook('crete-content-regenerate', { content_id: req.params.id, notes });
        res.json({ ok: true, item });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // POST /api/crete/content/regenerate/:id
    this.app.post('/api/crete/content/regenerate/:id', async (req, res) => {
      try {
        if (!creteConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 2000) : '';
        const patch = {
          status: 'pending_review',
          reviewer_notes: notes || null,
          updated_at: new Date().toISOString()
        };
        const r = await fetch(`${CRETE_TABLE}?id=eq.${req.params.id}`, {
          method: 'PATCH',
          headers: creteHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify(patch)
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || 'Supabase error' });
        creteFireWebhook('crete-content-regenerate', { content_id: req.params.id, notes });
        res.json({ ok: true, item: Array.isArray(data) ? data[0] : data });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ─── GHL Marketing: Content Review Queue ─────────────────
    // Reads from marketing_drafts table. Same Supabase creds as Crete.
    const GHL_TABLE = `${CRETE_SUPABASE_URL}/rest/v1/marketing_drafts`;
    const GHL_VALID_STATUSES = ['pending_approval', 'approved', 'rejected', 'published', 'failed'];
    const ghlConfigured = () => Boolean(CRETE_SUPABASE_URL && CRETE_SUPABASE_KEY);
    const ghlFireWebhook = (name, payload) => {
      fetch(`${CRETE_N8N_BASE}/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => {
        if (!r.ok) log.warn(`[GHL] n8n webhook ${name} returned ${r.status}`);
      }).catch(err => {
        log.warn(`[GHL] n8n webhook ${name} failed: ${err.message}`);
      });
    };

    // GET /api/ghl/drafts — list marketing drafts (filter by status, paginated)
    this.app.get('/api/ghl/drafts', async (req, res) => {
      try {
        if (!ghlConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const params = new URLSearchParams({
          order: 'created_at.desc',
          limit: String(limit),
          offset: String(offset)
        });
        if (req.query.status && GHL_VALID_STATUSES.includes(req.query.status)) {
          params.set('status', `eq.${req.query.status}`);
        }
        const r = await fetch(`${GHL_TABLE}?${params}`, { headers: creteHeaders() });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || 'Supabase error' });
        res.json({ items: data, limit, offset });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // GET /api/ghl/drafts/:id
    this.app.get('/api/ghl/drafts/:id', async (req, res) => {
      try {
        if (!ghlConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const r = await fetch(`${GHL_TABLE}?id=eq.${req.params.id}`, { headers: creteHeaders() });
        const rows = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: rows.message || 'Supabase error' });
        if (!Array.isArray(rows) || !rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // ── Scheduling helpers ──────────────────────────────────
    // MWF calendar: 07:30 UTC on Mon/Wed/Fri. One draft per day max.
    // nextMwfSlot() walks forward up to 30 days and returns the first
    // slot without an existing approved-or-published draft on that date.
    const GHL_MWF_DAYS = [1, 3, 5]; // Mon=1, Wed=3, Fri=5
    const GHL_SLOT_HOUR_UTC = 7;
    const GHL_SLOT_MIN_UTC = 30;

    async function ghlSlotTaken(dateISO) {
      // dateISO is YYYY-MM-DD. Check for any approved/published draft whose
      // scheduled_for or published_at falls inside this UTC day.
      const dayStart = `${dateISO}T00:00:00.000Z`;
      const dayEnd   = `${dateISO}T23:59:59.999Z`;
      const q = new URLSearchParams({
        'or': `(status.eq.approved,status.eq.published,status.eq.partially_published)`,
        'scheduled_for': `gte.${dayStart}`,
        'select': 'id,scheduled_for,status'
      });
      q.append('scheduled_for', `lte.${dayEnd}`);
      const r = await fetch(`${GHL_TABLE}?${q}`, { headers: creteHeaders() });
      if (!r.ok) return false; // fail open — don't block on transient errors
      const rows = await r.json();
      return Array.isArray(rows) && rows.length > 0;
    }

    async function ghlNextMwfSlot(excludeId = null) {
      const now = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(Date.UTC(
          now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i,
          GHL_SLOT_HOUR_UTC, GHL_SLOT_MIN_UTC, 0, 0
        ));
        if (d <= now) continue;
        if (!GHL_MWF_DAYS.includes(d.getUTCDay())) continue;
        const dateISO = d.toISOString().slice(0, 10);
        if (await ghlSlotTaken(dateISO)) continue;
        return d.toISOString();
      }
      throw new Error('No available MWF slot within 30 days');
    }

    async function ghlPatchDraft(id, patch, res) {
      const r = await fetch(`${GHL_TABLE}?id=eq.${id}`, {
        method: 'PATCH',
        headers: creteHeaders({ Prefer: 'return=representation' }),
        body: JSON.stringify(patch)
      });
      const data = await r.json();
      if (!r.ok) { res.status(r.status).json({ error: data.message || 'Supabase error' }); return null; }
      return Array.isArray(data) ? data[0] : data;
    }

    // PUT /api/ghl/drafts/:id/schedule — auto-pick next MWF slot
    this.app.put('/api/ghl/drafts/:id/schedule', async (req, res) => {
      try {
        if (!ghlConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        let slot;
        try { slot = await ghlNextMwfSlot(req.params.id); }
        catch (e) { return res.status(409).json({ error: e.message }); }
        const patch = { status: 'approved', scheduled_for: slot, updated_at: new Date().toISOString() };
        const item = await ghlPatchDraft(req.params.id, patch, res);
        if (!item) return;
        res.json({ ok: true, item, scheduled_for: slot });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // PUT /api/ghl/drafts/:id/post-now — publish immediately
    this.app.put('/api/ghl/drafts/:id/post-now', async (req, res) => {
      try {
        if (!ghlConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const now = new Date().toISOString();
        const patch = { status: 'approved', scheduled_for: now, updated_at: now };
        const item = await ghlPatchDraft(req.params.id, patch, res);
        if (!item) return;
        ghlFireWebhook('ghl-marketing-publish', { draftId: req.params.id });
        res.json({ ok: true, item });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // PUT /api/ghl/drafts/:id/schedule-custom — user-picked datetime
    // Body: { scheduled_for: ISO8601 string }
    this.app.put('/api/ghl/drafts/:id/schedule-custom', async (req, res) => {
      try {
        if (!ghlConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const iso = req.body?.scheduled_for;
        if (typeof iso !== 'string') return res.status(400).json({ error: 'scheduled_for required' });
        const when = new Date(iso);
        if (isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid date' });
        if (when <= new Date()) return res.status(400).json({ error: 'scheduled_for must be in the future' });
        const patch = { status: 'approved', scheduled_for: when.toISOString(), updated_at: new Date().toISOString() };
        const item = await ghlPatchDraft(req.params.id, patch, res);
        if (!item) return;
        res.json({ ok: true, item, scheduled_for: when.toISOString() });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // PUT /api/ghl/drafts/:id/approve — legacy alias: now equivalent to /schedule
    // Kept for backward compatibility (e.g. Telegram "go" reply path).
    this.app.put('/api/ghl/drafts/:id/approve', async (req, res) => {
      try {
        if (!ghlConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        let slot;
        try { slot = await ghlNextMwfSlot(req.params.id); }
        catch (e) { return res.status(409).json({ error: e.message }); }
        const patch = { status: 'approved', scheduled_for: slot, updated_at: new Date().toISOString() };
        const item = await ghlPatchDraft(req.params.id, patch, res);
        if (!item) return;
        res.json({ ok: true, item, scheduled_for: slot });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // PUT /api/ghl/drafts/:id/reject
    this.app.put('/api/ghl/drafts/:id/reject', async (req, res) => {
      try {
        if (!ghlConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.slice(0, 2000) : '';
        const patch = { status: 'rejected', feedback: feedback || null, updated_at: new Date().toISOString() };
        const r = await fetch(`${GHL_TABLE}?id=eq.${req.params.id}`, {
          method: 'PATCH',
          headers: creteHeaders({ Prefer: 'return=representation' }),
          body: JSON.stringify(patch)
        });
        const data = await r.json();
        if (!r.ok) return res.status(r.status).json({ error: data.message || 'Supabase error' });
        res.json({ ok: true, item: Array.isArray(data) ? data[0] : data });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // POST /api/ghl/drafts/:id/regenerate — fires Approval Handler regenerate path
    this.app.post('/api/ghl/drafts/:id/regenerate', async (req, res) => {
      try {
        if (!ghlConfigured()) return res.status(500).json({ error: 'Supabase not configured' });
        if (!creteValidUuid(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
        const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback.slice(0, 2000) : '';
        ghlFireWebhook('ghl-marketing-regenerate', { draftId: req.params.id, feedback });
        res.json({ ok: true });
      } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // POST /api/crete/generate-image
    // Body: { style: "quote"|"editorial", text: "...", headline: "...", body: "..." }
    // Returns: { success: true, url: "https://media.creteprojects.com/images/..." }
    this.app.post('/api/crete/generate-image', async (req, res) => {
      try {
        const { style, text, headline, body: bodyText } = req.body || {};
        if (!style || (style !== 'quote' && style !== 'editorial')) {
          return res.status(400).json({ error: 'style must be "quote" or "editorial"' });
        }
        if (style === 'quote' && !text) {
          return res.status(400).json({ error: 'text is required for quote style' });
        }
        if (style === 'editorial' && !headline) {
          return res.status(400).json({ error: 'headline is required for editorial style' });
        }

        // Generate image
        const { generateTextCard } = await import('../crete-marketing/generate-text-card.js');
        const pngBuffer = await generateTextCard({ style, text, headline, body: bodyText });

        // Upload to R2
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const { randomUUID } = await import('crypto');

        const envPath = join(process.env.HOME || '/root', '.quantumclaw', '.env');
        const envVars = {};
        try {
          const envContent = readFileSync(envPath, 'utf-8');
          for (const line of envContent.split('\n')) {
            const match = line.match(/^([A-Z0-9_]+)=(.+)$/);
            if (match) envVars[match[1]] = match[2];
          }
        } catch { return res.status(500).json({ error: 'Could not read R2 credentials' }); }

        const accountId = envVars.R2_ACCOUNT_ID;
        const accessKeyId = envVars.R2_ACCESS_KEY_ID;
        const secretAccessKey = envVars.R2_SECRET_ACCESS_KEY;
        const bucket = envVars.CRETE_R2_BUCKET_NAME || 'crete-projects';
        const publicBase = (envVars.CRETE_R2_PUBLIC_URL || 'https://media.creteprojects.com').replace(/\/+$/, '');

        if (!accountId || !accessKeyId || !secretAccessKey) {
          return res.status(500).json({ error: 'R2 credentials not configured' });
        }

        const s3 = new S3Client({
          region: 'auto',
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: { accessKeyId, secretAccessKey }
        });

        const fileKey = `images/${randomUUID()}.png`;
        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: fileKey,
          Body: pngBuffer,
          ContentType: 'image/png'
        }));

        const publicUrl = `${publicBase}/${fileKey}`;
        log.info(`[CRETE] Generated ${style} card → ${publicUrl}`);
        res.json({ success: true, url: publicUrl, style, key: fileKey });
      } catch (err) {
        log.error(`[CRETE] generate-image error: ${err.message}`);
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
