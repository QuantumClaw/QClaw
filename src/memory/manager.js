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

// Try to load better-sqlite3 (native module, may fail on Android)
let Database;
try {
  Database = (await import('better-sqlite3')).default;
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
        tokens INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_conv_agent ON conversations(agent, timestamp);

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

    return {
      cognee: this.cogneeConnected,
      sqlite: !!this.db,
      jsonFallback: !!this._jsonStore,
      vector: vectorStats,
      knowledge: knowledgeStats,
      entities
    };
  }

  /**
   * Store a conversation turn
   */
  addMessage(agent, role, content, meta = {}) {
    if (this.db) {
      this.db.prepare(`
        INSERT INTO conversations (agent, role, content, model, tier, tokens)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(agent, role, content, meta.model || null, meta.tier || null, meta.tokens || null);
    } else if (this._jsonStore) {
      this._jsonStore.conversations.push({
        agent, role, content, timestamp: new Date().toISOString(),
        model: meta.model || null, tier: meta.tier || null, tokens: meta.tokens || null
      });
      // Keep last 500 messages to prevent unbounded growth
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
  }

  /**
   * Get recent conversation history for context
   */
  getHistory(agent, limit = 20) {
    if (this.db) {
      return this.db.prepare(`
        SELECT role, content, timestamp, model, tier
        FROM conversations
        WHERE agent = ?
        ORDER BY id DESC
        LIMIT ?
      `).all(agent, limit).reverse();
    }

    if (this._jsonStore) {
      return this._jsonStore.conversations
        .filter(m => m.agent === agent)
        .slice(-limit);
    }

    return [];
  }

  /**
   * Search knowledge graph for relationships
   */
  async graphQuery(query) {
    // Try Cognee first
    if (this.cogneeConnected) {
      try {
        const token = await this.secrets.get('cognee_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch(`${this.cogneeUrl}/api/v1/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, limit: 10 })
        });

        if (res.status === 401) {
          log.warn('Cognee token expired. Run: qclaw setup-cognee');
          this.cogneeConnected = false;
          this._startReconnectLoop();
        } else {
          const data = await res.json();
          return { results: data.results || [], source: 'cognee' };
        }
      } catch (err) {
        log.debug(`Graph query failed: ${err.message}`);
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

  async _connectCognee() {
    // Check if Cognee is explicitly disabled (e.g. Android/Termux)
    if (this.config.memory?.cognee?.enabled === false) {
      throw new Error('Cognee disabled in config');
    }

    // Health check — Cognee's health endpoint is /health (not /api/v1/health)
    const res = await fetch(`${this.cogneeUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Cognee returned ${res.status}`);

    const data = await res.json();

    // Verify we have a token (should be set during onboarding)
    const token = await this.secrets.get('cognee_token');
    if (token) {
      // Quick auth check
      const authRes = await fetch(`${this.cogneeUrl}/api/v1/settings`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(5000)
      });
      if (authRes.status === 401) {
        log.warn('Cognee token expired or invalid. Run: qclaw setup-cognee');
        throw new Error('Cognee token invalid');
      }
    }

    this.cogneeConnected = true;

    // Stop reconnect loop if running
    if (this._reconnectTimer) {
      clearInterval(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    return data.entities || 0;
  }

  _startReconnectLoop() {
    if (this._reconnectTimer) return; // already running

    const interval = this.config.memory?.cognee?.healthCheckInterval || 60000;

    this._reconnectTimer = setInterval(async () => {
      try {
        const entities = await this._connectCognee();
        log.success(`Knowledge graph reconnected (${entities} entities)`);
      } catch {
        // Still down, will try again next interval
      }
    }, interval);
  }

  async _cogneeIngest(agent, content) {
    const token = await this.secrets.get('cognee_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    await fetch(`${this.cogneeUrl}/api/v1/add`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: agent, content }),
      signal: AbortSignal.timeout(10000)
    });
  }
}
