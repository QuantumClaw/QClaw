/**
 * QuantumClaw Memory Manager
 *
 * Layer 1: Knowledge graph (Cognee) — relationships, entities, traversal
 * Layer 2: SQLite — conversation history, session context
 * Layer 3: Workspace files — always loaded
 *
 * Auto-reconnects to Cognee. Auto-refreshes tokens.
 * Never loops forever. Never requires manual intervention.
 *
 * If better-sqlite3 is unavailable (e.g. Android/Termux where native
 * compilation fails), falls back to a JSON file store. Less efficient
 * but functional.
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { log } from '../core/logger.js';
import { VectorMemory } from './vector.js';
import { KnowledgeStore } from './knowledge.js';
import { KnowledgeGraph, extractGraph } from './graph.js';

// Try to load better-sqlite3 (native module, may fail without build tools)
let Database = null;
try {
  const mod = await import('better-sqlite3');
  Database = mod.default;
  if (typeof Database !== 'function') Database = null;
} catch {
  Database = null;
}

export class MemoryManager {
  constructor(config, secrets) {
    this.config = config;
    this.secrets = secrets;
    this.cognee = null;
    this.cogneeConnected = false;
    this.cogneeUrl = config.memory?.cognee?.url || 'http://localhost:8000';
    this._cogneeToken = null;
    this._cogneeApiKey = null;
    this.db = null;
    this._jsonStore = null; // fallback if SQLite unavailable
    this._jsonStorePath = null;
    this._reconnectTimer = null;
  }

  async connect() {
    const dir = this.config._dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (Database) {
      // Native SQLite available
      this.db = new Database(join(dir, 'memory.db'));
      this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT DEFAULT (datetime('now')),
        model TEXT,
        tier TEXT,
        tokens INTEGER,
        channel TEXT DEFAULT 'dashboard',
        user_id TEXT,
        username TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations(agent, timestamp);
      CREATE INDEX IF NOT EXISTS idx_conv_channel ON conversations(channel, timestamp);
      CREATE INDEX IF NOT EXISTS idx_conv_thread ON conversations(agent, channel, user_id);

      CREATE TABLE IF NOT EXISTS context (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated TEXT DEFAULT (datetime('now'))
      );
    `);

      log.debug('Memory: using SQLite (native)');
    } else {
      // Fallback: JSON file store (works on Android/Termux without native compilation)
      log.warn('better-sqlite3 unavailable — using JSON file memory (install build tools for better performance)');
      this._jsonStorePath = join(dir, 'memory.json');
      try {
        this._jsonStore = existsSync(this._jsonStorePath)
          ? JSON.parse(readFileSync(this._jsonStorePath, 'utf-8'))
          : { conversations: [], context: {} };
      } catch {
        this._jsonStore = { conversations: [], context: {} };
      }
    }

    // Try Cognee connection (don't block if it fails)
    let entities = 0;
    try {
      entities = await this._connectCognee();
    } catch (err) {
      log.debug(`Cognee connection failed: ${err.message}`);
      this._startReconnectLoop();
    }

    // Always init vector memory (works everywhere, fallback for graph queries)
    this.vector = new VectorMemory(this.config, this.secrets);
    const vectorStats = await this.vector.init();

    // Init structured knowledge store (human-like memory types)
    this.knowledge = new KnowledgeStore(this.db, this._jsonStore);
    this.knowledge.init();
    const knowledgeStats = this.knowledge.stats();
    if (knowledgeStats.total > 0) {
      log.debug(`Knowledge: ${knowledgeStats.semantic} facts, ${knowledgeStats.episodic} events, ${knowledgeStats.procedural} prefs (~${knowledgeStats.estimatedTokens} tokens)`);
    }

    // Init knowledge graph (entity-relationship graph, works everywhere)
    this.graph = new KnowledgeGraph(this.db);
    this.graph.init();
    const graphStats = this.graph.stats();
    if (graphStats.entities > 0) {
      log.debug(`Graph: ${graphStats.entities} entities, ${graphStats.relationships} relationships`);
    }

    return {
      cognee: this.cogneeConnected,
      sqlite: !!this.db,
      jsonFallback: !!this._jsonStore,
      vector: vectorStats,
      knowledge: knowledgeStats,
      graph: graphStats,
      entities
    };
  }

  /**
   * Store a conversation turn
   */
  addMessage(agent, role, content, meta = {}) {
    if (this.db) {
      this.db.prepare(`
        INSERT INTO conversations (agent, role, content, model, tier, tokens, channel, user_id, username)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(agent, role, content, meta.model || null, meta.tier || null, meta.tokens || null,
             meta.channel || 'dashboard', meta.userId || null, meta.username || null);
    } else if (this._jsonStore) {
      this._jsonStore.conversations.push({
        agent, role, content, timestamp: new Date().toISOString(),
        model: meta.model || null, tier: meta.tier || null, tokens: meta.tokens || null,
        channel: meta.channel || 'dashboard', userId: meta.userId || null, username: meta.username || null
      });
      if (this._jsonStore.conversations.length > 500) {
        this._jsonStore.conversations = this._jsonStore.conversations.slice(-500);
      }
      this._saveJsonStore();
    }

    // If Cognee is connected, also extract entities/relationships
    if (this.cogneeConnected) {
      this._cogneeIngest(agent, content).catch(err => {
        log.debug(`Cognee ingest failed: ${err.message}`);
      });
    }

    // Index into vector memory (works everywhere — Termux, desktop, server)
    if (this.vector && content.length > 20) {
      this.vector.add(content, { agent, role }).catch(() => {});
    }

    // Extract entities/relationships into knowledge graph
    if (this.graph && this._router && content.length > 40) {
      extractGraph(this._router, this.graph, content, role).catch(() => {});
    }
  }

  /**
   * Get recent conversation history for context
   */
  getHistory(agent, limit = 20, options = {}) {
    const { channel, userId } = options;

    if (this.db) {
      let sql = `SELECT role, content, timestamp, model, tier, channel, user_id, username
                 FROM conversations WHERE agent = ?`;
      const params = [agent];

      if (channel) { sql += ' AND channel = ?'; params.push(channel); }
      if (userId) { sql += ' AND user_id = ?'; params.push(userId); }

      sql += ' ORDER BY id DESC LIMIT ?';
      params.push(limit);

      return this.db.prepare(sql).all(...params).reverse();
    }

    if (this._jsonStore) {
      let msgs = this._jsonStore.conversations.filter(m => m.agent === agent);
      if (channel) msgs = msgs.filter(m => m.channel === channel);
      if (userId) msgs = msgs.filter(m => m.userId === userId);
      return msgs.slice(-limit);
    }

    return [];
  }

  /**
   * Get conversation threads (grouped by channel + user)
   */
  getThreads(agent) {
    if (this.db) {
      return this.db.prepare(`
        SELECT channel, user_id, username,
               COUNT(*) as messageCount,
               MAX(timestamp) as lastMessage,
               MIN(timestamp) as firstMessage
        FROM conversations
        WHERE agent = ?
        GROUP BY channel, user_id
        ORDER BY MAX(timestamp) DESC
      `).all(agent);
    }

    if (this._jsonStore) {
      const threads = new Map();
      this._jsonStore.conversations
        .filter(m => m.agent === agent)
        .forEach(m => {
          const key = `${m.channel || 'dashboard'}:${m.userId || 'local'}`;
          if (!threads.has(key)) {
            threads.set(key, {
              channel: m.channel || 'dashboard',
              user_id: m.userId || null,
              username: m.username || null,
              messageCount: 0,
              lastMessage: m.timestamp,
              firstMessage: m.timestamp
            });
          }
          const t = threads.get(key);
          t.messageCount++;
          if (m.timestamp > t.lastMessage) t.lastMessage = m.timestamp;
        });
      return [...threads.values()].sort((a, b) => b.lastMessage.localeCompare(a.lastMessage));
    }

    return [];
  }

  /**
   * Get conversation stats
   */
  getStats() {
    if (this.db) {
      const total = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get();
      const byChannel = this.db.prepare(`
        SELECT channel, COUNT(*) as count FROM conversations GROUP BY channel
      `).all();
      const byAgent = this.db.prepare(`
        SELECT agent, COUNT(*) as count FROM conversations GROUP BY agent
      `).all();
      const today = this.db.prepare(`
        SELECT COUNT(*) as count FROM conversations WHERE timestamp >= date('now')
      `).get();
      return {
        total: total.count,
        today: today.count,
        byChannel,
        byAgent
      };
    }
    return { total: this._jsonStore?.conversations?.length || 0, today: 0, byChannel: [], byAgent: [] };
  }

  /**
   * Set the LLM router reference (needed for knowledge extraction)
   */
  setRouter(router) {
    this._router = router;
  }

  /**
   * Search knowledge graph for relationships.
   *
   * Cognee search types (in order of usefulness for QClaw):
   *   GRAPH_COMPLETION  — LLM-powered response using graph context (best for questions)
   *   CHUNKS            — raw text segments matching the query
   *   SUMMARIES         — pre-generated hierarchical summaries
   *   RAG_COMPLETION    — LLM answer from retrieved chunks
   *   FEELING_LUCKY     — auto-select search type
   */
  /**
   * Get knowledge graph as nodes + edges for visualization.
   */
  async getGraph() {
    const nodes = [];
    const edges = [];
    const nodeMap = new Map();

    const addNode = (id, label, type) => {
      if (!nodeMap.has(id)) {
        nodeMap.set(id, nodes.length);
        nodes.push({ id, label: label.slice(0, 60), type });
      }
      return nodeMap.get(id);
    };

    // Pull knowledge entries
    if (this.knowledge) {
      for (const type of ['semantic', 'episodic', 'procedural']) {
        const entries = this.knowledge.getByType(type, 100);
        for (const entry of entries) {
          const nodeId = `k-${entry.id || entries.indexOf(entry)}`;
          addNode(nodeId, entry.content || entry.text || '', type);

          // Extract entity references and create edges
          const text = (entry.content || entry.text || '').toLowerCase();
          for (const other of entries) {
            if (other === entry) continue;
            const otherId = `k-${other.id || entries.indexOf(other)}`;
            const otherText = (other.content || other.text || '').toLowerCase();
            // Simple co-reference: if entries share significant words
            const words = text.split(/\s+/).filter(w => w.length > 4);
            for (const word of words) {
              if (otherText.includes(word)) {
                edges.push({ source: nodeId, target: otherId, label: word });
                break; // one edge per pair
              }
            }
          }
        }
      }
    }

    return { nodes, edges };
  }

  async graphQuery(query) {
    // Try Cognee first (remote knowledge graph)
    if (this.cogneeConnected) {
      try {
        const headers = this._cogneeHeaders();
        const searchType = this.config.memory?.cognee?.searchType || 'GRAPH_COMPLETION';

        const res = await fetch(`${this.cogneeUrl}/api/v1/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query,
            search_type: searchType,
            datasets: [this.config.memory?.cognee?.dataset || 'quantumclaw'],
          }),
          signal: AbortSignal.timeout(15000)
        });

        if (res.status === 401) {
          log.warn('Cognee auth expired during search — reconnecting');
          this.cogneeConnected = false;
          this._cogneeToken = null;
          this._startReconnectLoop();
        } else if (res.ok) {
          const data = await res.json();
          // Cognee returns results in various formats depending on search type
          const results = Array.isArray(data) ? data : (data.results || data.data || []);
          if (results.length > 0) {
            return {
              results: results.map(r => ({
                content: typeof r === 'string' ? r : (r.content || r.text || r.chunk_text || JSON.stringify(r))
              })),
              source: `cognee-${searchType.toLowerCase()}`
            };
          }
        }
      } catch (err) {
        log.debug(`Cognee search failed: ${err.message}`);
      }
    }

    // Local knowledge graph (entities + relationships)
    if (this.graph) {
      const graphContext = this.graph.buildGraphContext(query, 500);
      if (graphContext && graphContext.length > 20) {
        const graphStats = this.graph.stats();
        return { results: [{ content: graphContext }], source: 'graph', entities: graphStats.entities, relationships: graphStats.relationships };
      }
    }

    // Fallback: vector memory search
    if (this.vector) {
      try {
        const results = await this.vector.search(query, 10);
        return { results, source: this.vector._embeddingProvider ? 'vector-embedding' : 'vector-tfidf' };
      } catch (err) {
        log.debug(`Vector search failed: ${err.message}`);
      }
    }

    return { results: [], source: 'offline' };
  }

  /**
   * Store/retrieve arbitrary context
   */
  setContext(key, value) {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    if (this.db) {
      this.db.prepare(`
        INSERT OR REPLACE INTO context (key, value, updated) VALUES (?, ?, datetime('now'))
      `).run(key, strValue);
    } else if (this._jsonStore) {
      this._jsonStore.context[key] = strValue;
      this._saveJsonStore();
    }
  }

  getContext(key) {
    if (this.db) {
      const row = this.db.prepare('SELECT value FROM context WHERE key = ?').get(key);
      if (!row) return null;
      try { return JSON.parse(row.value); } catch { return row.value; }
    }
    if (this._jsonStore) {
      const val = this._jsonStore.context[key];
      if (val === undefined) return null;
      try { return JSON.parse(val); } catch { return val; }
    }
    return null;
  }

  async disconnect() {
    if (this._reconnectTimer) clearInterval(this._reconnectTimer);
    if (this.db) this.db.close();
    if (this._jsonStore) this._saveJsonStore();
  }

  _saveJsonStore() {
    if (!this._jsonStorePath || !this._jsonStore) return;
    try {
      const tmp = this._jsonStorePath + '.tmp';
      writeFileSync(tmp, JSON.stringify(this._jsonStore));
      renameSync(tmp, this._jsonStorePath);
    } catch (err) {
      log.debug(`JSON store save failed: ${err.message}`);
    }
  }

  // ─── Cognee internals ───────────────────────────────────
  //
  // Cognee API lifecycle:
  //   1. Health check:  GET  /api/v1/health
  //   2. Login:         POST /api/v1/auth/login  → JWT token (cookie-based auth)
  //   3. Add data:      POST /api/v1/add         → ingest text into a dataset
  //   4. Cognify:       POST /api/v1/cognify     → build knowledge graph (entities + relationships)
  //   5. Search:        POST /api/v1/search      → query the graph (GRAPH_COMPLETION, CHUNKS, etc.)
  //   6. Datasets:      GET  /api/v1/datasets    → list datasets and their status
  //
  // For Cognee Cloud: use X-Api-Key header instead of login flow.
  // For local Docker:  use cookie login (username/password) or run without auth.

  /**
   * Build the auth headers for Cognee API calls.
   * Supports three modes:
   *   1. API key (Cognee Cloud) — X-Api-Key header
   *   2. JWT token (local with auth) — Authorization: Bearer
   *   3. No auth (local without REQUIRE_AUTH)
   */
  /**
   * Configure Cognee's LLM and embedding providers via environment variables.
   * Cognee uses Pydantic settings which read from env vars.
   * This bridges QClaw's config → Cognee's expected env vars.
   */
  _configureCogneeEnv() {
    const emb = this.config.memory?.embedding;
    const primary = this.config.models?.primary;

    // ── LLM config (for Cognee's entity extraction / cognify) ──
    if (primary) {
      const llmKey = this.secrets.get?.(`${primary.provider}_api_key`) || '';
      if (llmKey) process.env.LLM_API_KEY = llmKey;

      // Map QClaw provider names → Cognee LLM_PROVIDER values
      const providerMap = {
        anthropic: 'anthropic', openai: 'openai', groq: 'groq',
        openrouter: 'openrouter', google: 'gemini', xai: 'openai',
        ollama: 'ollama',
      };
      if (providerMap[primary.provider]) process.env.LLM_PROVIDER = providerMap[primary.provider];
      if (primary.model && primary.model !== 'auto') process.env.LLM_MODEL = primary.model;

      // Provider-specific endpoints
      if (primary.provider === 'ollama') process.env.LLM_ENDPOINT = 'http://localhost:11434/v1';
      if (primary.provider === 'openrouter') process.env.LLM_ENDPOINT = 'https://openrouter.ai/api/v1';
      if (primary.provider === 'groq') process.env.LLM_ENDPOINT = 'https://api.groq.com/openai/v1';
      if (primary.provider === 'xai') process.env.LLM_ENDPOINT = 'https://api.x.ai/v1';
    }

    // ── Embedding config ──
    if (emb) {
      const embKey = this.secrets.get?.('embedding_api_key')
                  || this.secrets.get?.('openai_api_key')
                  || process.env.LLM_API_KEY || '';

      if (embKey) process.env.EMBEDDING_API_KEY = embKey;
      if (emb.provider) process.env.EMBEDDING_PROVIDER = emb.provider;
      if (emb.model) process.env.EMBEDDING_MODEL = emb.model;
      if (emb.dimensions) process.env.EMBEDDING_DIMENSIONS = String(emb.dimensions);
      if (emb.endpoint) process.env.EMBEDDING_ENDPOINT = emb.endpoint;
    }

    // Ensure vector DB uses lancedb (lightweight, no server needed)
    if (!process.env.VECTOR_DB_PROVIDER) process.env.VECTOR_DB_PROVIDER = 'lancedb';
  }

  /**
   * Push LLM/embedding settings to Cognee via its settings API.
   * This is essential for Docker Cognee which runs as a separate process
   * and doesn't inherit QClaw's environment variables.
   */
  async _pushCogneeSettings() {
    const emb = this.config.memory?.embedding;
    const primary = this.config.models?.primary;
    if (!emb && !primary) return;

    const settings = {};

    // LLM settings
    if (primary) {
      const providerMap = {
        anthropic: 'anthropic', openai: 'openai', groq: 'groq',
        openrouter: 'openrouter', google: 'gemini', xai: 'openai',
        ollama: 'ollama',
      };
      const llmKey = this.secrets.get?.(`${primary.provider}_api_key`) || '';
      if (llmKey) settings.llm_api_key = llmKey;
      if (providerMap[primary.provider]) settings.llm_provider = providerMap[primary.provider];
      if (primary.model && primary.model !== 'auto') settings.llm_model = primary.model;
    }

    // Embedding settings
    if (emb) {
      const embKey = this.secrets.get?.('embedding_api_key')
                  || this.secrets.get?.('openai_api_key') || '';
      if (embKey) settings.embedding_api_key = embKey;
      if (emb.provider) settings.embedding_provider = emb.provider;
      if (emb.model) settings.embedding_model = emb.model;
      if (emb.dimensions) settings.embedding_dimensions = emb.dimensions;
      if (emb.endpoint) settings.embedding_endpoint = emb.endpoint;
    }

    if (Object.keys(settings).length === 0) return;

    try {
      const res = await fetch(`${this.cogneeUrl}/api/v1/settings`, {
        method: 'POST',
        headers: { ...this._cogneeHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        log.debug(`Cognee settings pushed: ${Object.keys(settings).filter(k => !k.includes('key')).join(', ')}`);
      } else {
        // Non-fatal — settings API may not exist on older Cognee versions
        log.debug(`Cognee settings API returned ${res.status} — using env vars instead`);
      }
    } catch {
      // Non-fatal — settings push failed, env vars are the fallback
      log.debug('Cognee settings API not available — trying Docker restart');
      await this._restartDockerCogneeWithEnv(settings);
    }
  }

  /**
   * If Cognee runs in Docker, restart the container with correct env vars.
   * This is a fallback when the /api/v1/settings endpoint isn't available.
   */
  async _restartDockerCogneeWithEnv(settings) {
    try {
      const { execSync } = await import('child_process');
      // Check if quantumclaw-cognee container exists
      const ps = execSync('docker ps -a --format "{{.Names}}" 2>/dev/null', { encoding: 'utf-8' });
      if (!ps.includes('quantumclaw-cognee')) return;

      // Build env flags
      const envMap = {
        llm_api_key: 'LLM_API_KEY', llm_provider: 'LLM_PROVIDER', llm_model: 'LLM_MODEL',
        embedding_api_key: 'EMBEDDING_API_KEY', embedding_provider: 'EMBEDDING_PROVIDER',
        embedding_model: 'EMBEDDING_MODEL', embedding_dimensions: 'EMBEDDING_DIMENSIONS',
        embedding_endpoint: 'EMBEDDING_ENDPOINT',
      };
      const envFlags = Object.entries(settings)
        .filter(([k, v]) => envMap[k] && v)
        .map(([k, v]) => `-e ${envMap[k]}="${String(v).replace(/"/g, '\\"')}"`)
        .join(' ');

      if (!envFlags) return;

      log.debug('Restarting Docker Cognee with env vars...');
      execSync('docker stop quantumclaw-cognee 2>/dev/null || true', { encoding: 'utf-8' });
      execSync('docker rm quantumclaw-cognee 2>/dev/null || true', { encoding: 'utf-8' });
      execSync(
        `docker run -d --name quantumclaw-cognee --restart unless-stopped ` +
        `-p 8000:8000 -e VECTOR_DB_PROVIDER=lancedb -e ENABLE_BACKEND_ACCESS_CONTROL=false ` +
        `${envFlags} ` +
        `-v quantumclaw-cognee-data:/app/cognee/.cognee_system ` +
        `cognee/cognee:main`,
        { encoding: 'utf-8' }
      );
      log.info('Docker Cognee restarted with LLM/embedding config');

      // Wait for it to come back up
      for (let i = 0; i < 15; i++) {
        try {
          const res = await fetch(`${this.cogneeUrl}/health`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) { log.debug('Docker Cognee healthy after restart'); return; }
        } catch { /* waiting */ }
        await new Promise(r => setTimeout(r, 1000));
      }
      log.warn('Docker Cognee restart: health check timed out (may still be starting)');
    } catch (err) {
      // Docker not available or not a Docker install — that's fine
      log.debug(`Docker Cognee restart skipped: ${err.message}`);
    }
  }

  _cogneeHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this._cogneeApiKey) {
      headers['X-Api-Key'] = this._cogneeApiKey;
    } else if (this._cogneeToken) {
      headers['Authorization'] = `Bearer ${this._cogneeToken}`;
    }
    return headers;
  }

  async _connectCognee() {
    // Check if Cognee is explicitly disabled (e.g. Android/Termux)
    if (this.config.memory?.cognee?.enabled === false) {
      throw new Error('Cognee disabled in config');
    }

    // ── Configure Cognee's LLM & embeddings via environment variables ──
    // Cognee reads these from the environment (Pydantic settings)
    this._configureCogneeEnv();

    // Health check — try detailed endpoint first, fall back to basic
    let healthData;
    try {
      const res = await fetch(`${this.cogneeUrl}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        healthData = await res.json();
      } else {
        // Fall back to basic health endpoint
        const basicRes = await fetch(`${this.cogneeUrl}/health`, { signal: AbortSignal.timeout(5000) });
        if (!basicRes.ok) throw new Error(`Cognee returned ${basicRes.status}`);
        healthData = await basicRes.json();
      }
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Cognee health check timed out');
      throw err;
    }

    // ── Authentication ──────────────────────────────────────
    // Priority: 1) API key (cloud), 2) existing JWT, 3) login with credentials, 4) no auth

    // Check for Cognee Cloud API key
    this._cogneeApiKey = this.secrets.get?.('cognee_api_key') || null;

    if (!this._cogneeApiKey) {
      // Try existing JWT token
      this._cogneeToken = this.secrets.get?.('cognee_token') || null;

      if (this._cogneeToken) {
        // Verify the token is still valid
        const authRes = await fetch(`${this.cogneeUrl}/api/v1/settings`, {
          headers: this._cogneeHeaders(),
          signal: AbortSignal.timeout(5000)
        });
        if (authRes.status === 401) {
          log.debug('Cognee token expired — attempting re-login');
          this._cogneeToken = null;
        }
      }

      // If no valid token, attempt login with stored credentials
      if (!this._cogneeToken) {
        const username = this.secrets.get?.('cognee_username')
          || this.config.memory?.cognee?.username
          || process.env.COGNEE_USERNAME;
        const password = this.secrets.get?.('cognee_password')
          || this.config.memory?.cognee?.password
          || process.env.COGNEE_PASSWORD;

        if (username && password) {
          try {
            this._cogneeToken = await this._cogneeLogin(username, password);
            // Persist the token for next startup
            if (this.secrets.set) this.secrets.set('cognee_token', this._cogneeToken);
            log.debug('Cognee: logged in successfully');
          } catch (loginErr) {
            log.warn(`Cognee login failed: ${loginErr.message}`);
            // Continue without auth — Cognee may have auth disabled
          }
        }
      }
    }

    // Verify we can actually reach a protected endpoint (or that auth isn't required)
    try {
      const settingsRes = await fetch(`${this.cogneeUrl}/api/v1/settings`, {
        headers: this._cogneeHeaders(),
        signal: AbortSignal.timeout(5000)
      });
      // 200 = authenticated, 401 = auth required but we don't have it
      if (settingsRes.status === 401) {
        throw new Error('Cognee requires authentication. Set COGNEE_USERNAME/COGNEE_PASSWORD or cognee_api_key.');
      }
    } catch (err) {
      if (err.message.includes('requires authentication')) throw err;
      // Network error accessing settings — Cognee might not have the endpoint, continue
    }

    // ── Push LLM/embedding settings via API (for Docker Cognee) ──
    await this._pushCogneeSettings();

    this.cogneeConnected = true;

    // Stop reconnect loop if running
    if (this._reconnectTimer) {
      clearInterval(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    // Get dataset count for logging
    let entityCount = 0;
    try {
      const dsRes = await fetch(`${this.cogneeUrl}/api/v1/datasets`, {
        headers: this._cogneeHeaders(),
        signal: AbortSignal.timeout(5000)
      });
      if (dsRes.ok) {
        const datasets = await dsRes.json();
        entityCount = Array.isArray(datasets) ? datasets.length : 0;
      }
    } catch { /* non-fatal */ }

    return entityCount;
  }

  /**
   * Login to Cognee and get a JWT token.
   * Cognee uses FastAPI-Users with cookie auth — POST form data to /api/v1/auth/login
   */
  async _cogneeLogin(username, password) {
    const res = await fetch(`${this.cogneeUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username, password }),
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Login failed (${res.status}): ${body}`);
    }

    // Cognee returns the token in the response body or as a cookie
    const data = await res.json().catch(() => null);

    // Try response body first (newer Cognee versions)
    if (data?.access_token) return data.access_token;
    if (data?.token) return data.token;

    // Try cookie (FastAPI-Users cookie transport)
    const setCookie = res.headers.get('set-cookie') || '';
    const tokenMatch = setCookie.match(/fastapiusersauth=([^;]+)/);
    if (tokenMatch) return tokenMatch[1];

    throw new Error('Login succeeded but no token returned');
  }

  _startReconnectLoop() {
    if (this._reconnectTimer) return; // already running

    const interval = this.config.memory?.cognee?.healthCheckInterval || 60000;

    this._reconnectTimer = setInterval(async () => {
      try {
        const count = await this._connectCognee();
        log.success(`Knowledge graph reconnected (${count} datasets)`);
      } catch {
        // Still down, will try again next interval
      }
    }, interval);
  }

  /**
   * Ingest content into Cognee's knowledge base.
   *
   * The Cognee lifecycle is:
   *   1. POST /api/v1/add   — add raw data to a dataset
   *   2. POST /api/v1/cognify — process data into knowledge graph
   *
   * We run cognify in the background (runInBackground: true) so it doesn't
   * block the agent's response. Cognee processes asynchronously.
   */
  async _cogneeIngest(agent, content) {
    const headers = this._cogneeHeaders();
    const datasetName = this.config.memory?.cognee?.dataset || 'quantumclaw';

    // Step 1: Add data to Cognee
    const addRes = await fetch(`${this.cogneeUrl}/api/v1/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: content,
        datasetName,
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!addRes.ok) {
      if (addRes.status === 401) {
        log.warn('Cognee auth expired during ingest — will re-authenticate');
        this.cogneeConnected = false;
        this._cogneeToken = null;
        this._startReconnectLoop();
        return;
      }
      throw new Error(`Cognee add failed: ${addRes.status}`);
    }

    // Step 2: Trigger cognify (build knowledge graph) — run in background
    // We don't await this — Cognee processes asynchronously
    fetch(`${this.cogneeUrl}/api/v1/cognify`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        datasets: [datasetName],
        runInBackground: true
      }),
      signal: AbortSignal.timeout(15000)
    }).catch(err => {
      log.debug(`Cognee cognify trigger failed: ${err.message}`);
    });
  }
}
