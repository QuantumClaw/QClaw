/**
 * QuantumClaw Completion Cache
 *
 * Don't pay for the same answer twice.
 * Uses shared database from @agexhq/store.
 * Falls back to JSON if no database is available.
 */

import { createHash } from 'crypto';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { log } from './logger.js';

export class CompletionCache {
  constructor(config) {
    const dir = config._dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.enabled = config.cache?.enabled !== false;
    this.defaultTTL = config.cache?.ttlMinutes || 60;
    this.stats = { hits: 0, misses: 0, saved: 0 };
    this._jsonPath = join(dir, 'completion-cache.json');
    this.db = null;
    this._useJson = true;
  }

  attach(db) {
    if (db) { this.db = db; this._useJson = false; }
    else { this._data = this._loadJson(); }
  }

  _loadJson() {
    try { return JSON.parse(readFileSync(this._jsonPath, 'utf8')); }
    catch { return {}; }
  }

  _saveJson() {
    const keys = Object.keys(this._data);
    if (keys.length > 500) {
      const sorted = keys.sort((a, b) => (this._data[a].last_hit || '') < (this._data[b].last_hit || '') ? -1 : 1);
      for (let i = 0; i < keys.length - 400; i++) delete this._data[sorted[i]];
    }
    writeFileSync(this._jsonPath, JSON.stringify(this._data));
  }

  get(messages, model) {
    if (!this.enabled) return null;
    const hash = this._hash(messages, model);

    if (this._useJson) {
      if (!this._data) this._data = this._loadJson();
      const entry = this._data[hash];
      if (entry && (!entry.expires || entry.expires > new Date().toISOString())) {
        entry.hits = (entry.hits || 0) + 1;
        entry.last_hit = new Date().toISOString();
        this._saveJson();
        this.stats.hits++;
        this.stats.saved += entry.cost_saved || 0;
        return { content: entry.response, cached: true, model: entry.model };
      }
      this.stats.misses++;
      return null;
    }

    const row = this.db.prepare('SELECT * FROM completion_cache WHERE hash = ? AND (expires IS NULL OR expires > datetime(\'now\'))').get(hash);
    if (row) {
      this.db.prepare('UPDATE completion_cache SET hits = hits + 1, last_hit = datetime(\'now\') WHERE hash = ?').run(hash);
      this.stats.hits++;
      this.stats.saved += row.cost_saved || 0;
      return { content: row.response, cached: true, model: row.model };
    }
    this.stats.misses++;
    return null;
  }

  set(messages, model, response, meta = {}) {
    if (!this.enabled) return;
    const hash = this._hash(messages, model);
    const ttl = meta.ttlMinutes || this.defaultTTL;

    if (this._useJson) {
      if (!this._data) this._data = this._loadJson();
      this._data[hash] = {
        model, response, tokens_saved: meta.tokens || 0, cost_saved: meta.cost || 0,
        hits: 1, created: new Date().toISOString(),
        expires: new Date(Date.now() + ttl * 60000).toISOString(),
        last_hit: new Date().toISOString()
      };
      this._saveJson();
      return;
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO completion_cache (hash, model, prompt_preview, response, tokens_saved, cost_saved, expires)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+${ttl} minutes'))
    `).run(hash, model, (messages[messages.length - 1]?.content || '').slice(0, 100), response, meta.tokens || 0, meta.cost || 0);
  }

  prune() {
    if (this._useJson) {
      if (!this._data) return;
      const now = new Date().toISOString();
      let pruned = 0;
      for (const [h, e] of Object.entries(this._data)) {
        if (e.expires && e.expires < now) { delete this._data[h]; pruned++; }
      }
      if (pruned) { this._saveJson(); log.debug(`Pruned ${pruned} cache entries`); }
      return;
    }
    const r = this.db.prepare('DELETE FROM completion_cache WHERE expires < datetime(\'now\')').run();
    if (r.changes > 0) log.debug(`Pruned ${r.changes} cache entries`);
  }

  getStats() {
    if (this._useJson) {
      const valid = Object.values(this._data || {}).filter(e => !e.expires || e.expires > new Date().toISOString());
      return { ...this.stats, entries: valid.length, total_hits: valid.reduce((s, e) => s + (e.hits || 0), 0), total_saved: valid.reduce((s, e) => s + (e.cost_saved || 0) * (e.hits || 0), 0) };
    }
    const d = this.db.prepare('SELECT COUNT(*) as entries, COALESCE(SUM(hits),0) as total_hits, COALESCE(SUM(cost_saved*hits),0) as total_saved FROM completion_cache WHERE expires IS NULL OR expires > datetime(\'now\')').get();
    return { ...this.stats, ...d };
  }

  _hash(messages, model) {
    return createHash('sha256').update(JSON.stringify({ messages, model })).digest('hex').slice(0, 16);
  }
}
