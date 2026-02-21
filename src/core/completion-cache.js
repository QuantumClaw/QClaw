/**
 * QuantumClaw Completion Cache
 *
 * Don't pay for the same answer twice.
 * Hashes the prompt, caches the response.
 * TTL-based expiry so stale answers die.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { log } from './logger.js';

export class CompletionCache {
  constructor(config) {
    const dir = config._dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(join(dir, 'completions.db'));
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        hash TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        prompt_preview TEXT,
        response TEXT NOT NULL,
        tokens_saved INTEGER DEFAULT 0,
        cost_saved REAL DEFAULT 0,
        hits INTEGER DEFAULT 1,
        created TEXT DEFAULT (datetime('now')),
        expires TEXT,
        last_hit TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache(expires);
    `);

    this.enabled = config.cache?.enabled !== false;
    this.defaultTTL = config.cache?.ttlMinutes || 60; // 1 hour default
    this.stats = { hits: 0, misses: 0, saved: 0 };
  }

  /**
   * Check cache for a matching completion
   */
  get(messages, model) {
    if (!this.enabled) return null;

    const hash = this._hash(messages, model);
    const row = this.db.prepare(`
      SELECT * FROM cache
      WHERE hash = ?
        AND (expires IS NULL OR expires > datetime('now'))
    `).get(hash);

    if (row) {
      // Update hit count
      this.db.prepare(`
        UPDATE cache SET hits = hits + 1, last_hit = datetime('now') WHERE hash = ?
      `).run(hash);

      this.stats.hits++;
      this.stats.saved += row.cost_saved || 0;
      log.debug(`Cache hit (saved £${(row.cost_saved || 0).toFixed(4)})`);

      return {
        content: row.response,
        cached: true,
        model: row.model
      };
    }

    this.stats.misses++;
    return null;
  }

  /**
   * Store a completion in cache
   */
  set(messages, model, response, meta = {}) {
    if (!this.enabled) return;

    const hash = this._hash(messages, model);
    const ttl = meta.ttlMinutes || this.defaultTTL;
    const preview = messages[messages.length - 1]?.content?.slice(0, 100) || '';

    this.db.prepare(`
      INSERT OR REPLACE INTO cache (hash, model, prompt_preview, response, tokens_saved, cost_saved, expires)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${ttl} minutes'))
    `).run(
      hash, model, preview, response,
      meta.tokens || 0, meta.cost || 0
    );
  }

  /**
   * Clean expired entries
   */
  prune() {
    const result = this.db.prepare(`
      DELETE FROM cache WHERE expires < datetime('now')
    `).run();

    if (result.changes > 0) {
      log.debug(`Pruned ${result.changes} expired cache entries`);
    }
  }

  /**
   * Stats for dashboard
   */
  getStats() {
    const dbStats = this.db.prepare(`
      SELECT
        COUNT(*) as entries,
        COALESCE(SUM(hits), 0) as total_hits,
        COALESCE(SUM(cost_saved * hits), 0) as total_saved
      FROM cache
      WHERE expires IS NULL OR expires > datetime('now')
    `).get();

    return {
      ...this.stats,
      ...dbStats
    };
  }

  _hash(messages, model) {
    const input = JSON.stringify({ messages, model });
    return createHash('sha256').update(input).digest('hex').slice(0, 16);
  }
}
