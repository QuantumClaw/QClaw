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
import { readFileSync } from 'fs';
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
    const host = this.config.dashboard?.host || '127.0.0.1';

    // Generate a session auth token (always — protects dashboard even locally)
    if (!this.config.dashboard?.authToken && !process.env.DASHBOARD_AUTH_TOKEN) {
      const { randomBytes } = await import('crypto');
      this.sessionToken = randomBytes(16).toString('hex');
      process.env.DASHBOARD_AUTH_TOKEN = this.sessionToken;
    } else {
      this.sessionToken = this.config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN;
    }

    this.app.use(express.json());

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

    // Create HTTP server
    this.server = createServer(this.app);

    // WebSocket for real-time chat
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this._setupWebSocket();

    // Find available port
    const actualPort = await this._listen(host, port);
    this.actualPort = actualPort;
    const localUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${actualPort}`;

    // Build the clickable URL with token in hash fragment
    // Hash fragment is never sent to the server in HTTP requests — stays client-side only
    this.dashUrl = `${localUrl}/#token=${this.sessionToken}`;

    // Start tunnel if configured or auto-detect
    let tunnelType = process.env.QCLAW_TUNNEL || this.config.dashboard?.tunnel || 'auto';
    if (tunnelType === 'auto') {
      // Auto-detect: try cloudflared first
      try {
        const { execSync } = await import('child_process');
        execSync('cloudflared --version', { stdio: 'ignore' });
        tunnelType = 'cloudflare';
      } catch {
        tunnelType = 'none';
      }
    }

    if (tunnelType && tunnelType !== 'none') {
      try {
        this.tunnelUrl = await this._startTunnel(tunnelType, actualPort);
        this.dashUrl = `${this.tunnelUrl}/#token=${this.sessionToken}`;
        log.success(`Tunnel: ${this.tunnelUrl}`);
      } catch (err) {
        log.warn(`Tunnel (${tunnelType}) failed: ${err.message} — dashboard is local only`);
      }
    }

    return this.dashUrl;
  }

  async stop() {
    if (this.tunnel) {
      try { await this._stopTunnel(); } catch { /* best effort */ }
    }
    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
  }

  _setupAPI() {
    // Rate limiter: track requests per IP per minute
    const rateLimit = new Map();
    const RATE_LIMIT = 30; // max requests per minute per IP
    const RATE_WINDOW = 60000;

    // Proactive cleanup every 2 minutes to prevent memory leak
    const rateLimitCleanup = setInterval(() => {
      const now = Date.now();
      for (const [key, val] of rateLimit) {
        if (now - val.start > RATE_WINDOW) rateLimit.delete(key);
      }
    }, 120000);
    rateLimitCleanup.unref(); // Don't keep process alive just for cleanup

    this.app.use((req, res, next) => {
      // Skip auth for HTML page and health check
      if (req.path === '/' || req.path === '/favicon.ico' || req.path === '/api/health') return next();

      // Optional auth token (set via config or env)
      const authToken = this.config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN;
      if (authToken) {
        const provided = req.headers['authorization']?.replace('Bearer ', '') || req.query.token;
        if (provided !== authToken) {
          return res.status(401).json({ error: 'Unauthorised' });
        }
      }

      // Rate limit check
      const ip = req.ip || req.socket.remoteAddress;
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

    // Agent chat endpoint
    this.app.post('/api/chat', async (req, res) => {
      try {
        const { message, agent: agentName } = req.body;
        const agent = this.qclaw.agents.get(agentName) || this.qclaw.agents.primary();
        const result = await agent.process(message);
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

    // Agents list
    this.app.get('/api/agents', (req, res) => {
      res.json(this.qclaw.agents.list());
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
      const { query } = req.body;
      const results = await this.qclaw.memory.graphQuery(query);
      res.json(results);
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

      ws.on('message', async (data) => {
        try {
          const { message, agent: agentName } = JSON.parse(data);
          const agent = this.qclaw.agents.get(agentName) || this.qclaw.agents.primary();

          // Send typing indicator
          ws.send(JSON.stringify({ type: 'typing', agent: agent.name }));

          const result = await agent.process(message);

          ws.send(JSON.stringify({
            type: 'response',
            ...result
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
      });
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
   * Uses quick tunnels (no account needed) or named tunnels
   */
  async _tunnelCloudflare(port) {
    const { spawn } = await import('child_process');

    const args = ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'];

    return new Promise((resolve, reject) => {
      const proc = spawn('cloudflared', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.tunnel = proc;
      let resolved = false;

      // cloudflared prints the URL to stderr
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
