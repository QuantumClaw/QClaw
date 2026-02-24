/**
 * QuantumClaw Audit Log
 *
 * Every action the agent takes gets logged. No exceptions.
 * Stored in SQLite for fast querying. Browsable in the dashboard.
 * Falls back to JSON file if better-sqlite3 is unavailable (Android/Termux).
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'fs';

// Try to load better-sqlite3 (optional — falls back to JSON)
let Database = null;
try {
  const mod = await import('better-sqlite3');
  Database = mod.default;
  // Test that the native binding actually works
  if (typeof Database !== 'function') Database = null;
} catch {
  Database = null;
}

export class AuditLog {
  constructor(config) {
    const dir = config._dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = null;
    this._logFile = null;

    if (Database) {
      this.db = new Database(join(dir, 'audit.db'));
      this.db.pragma('journal_mode = WAL');

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp TEXT DEFAULT (datetime('now')),
          agent TEXT NOT NULL,
          action TEXT NOT NULL,
          detail TEXT,
          model TEXT,
          cost REAL,
          tier TEXT,
          approved INTEGER DEFAULT 1,
          duration_ms INTEGER,
          channel TEXT DEFAULT 'unknown'
        )
      `);

      this._insert = this.db.prepare(`
        INSERT INTO audit (agent, action, detail, model, cost, tier, approved, duration_ms, channel)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    } else {
      // Fallback: append-only JSONL file
      this._logFile = join(dir, 'audit.jsonl');
    }
  }

  log(agent, action, detail, extra = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      agent, action,
      detail: detail || null,
      model: extra.model || null,
      cost: extra.cost || null,
      tier: extra.tier || null,
      approved: extra.approved !== undefined ? (extra.approved ? 1 : 0) : 1,
      duration_ms: extra.duration || null,
      channel: extra.channel || 'unknown'
    };

    if (this.db) {
      this._insert.run(
        entry.agent, entry.action, entry.detail, entry.model,
        entry.cost, entry.tier, entry.approved, entry.duration_ms, entry.channel
      );
    } else if (this._logFile) {
      try {
        appendFileSync(this._logFile, JSON.stringify(entry) + '\n');
      } catch { /* best effort */ }
    }
  }

  /**
   * Get recent audit entries
   */
  recent(limit = 50, agent = null) {
    if (this.db) {
      if (agent) {
        return this.db.prepare(
          'SELECT * FROM audit WHERE agent = ? ORDER BY id DESC LIMIT ?'
        ).all(agent, limit);
      }
      return this.db.prepare(
        'SELECT * FROM audit ORDER BY id DESC LIMIT ?'
      ).all(limit);
    }

    // JSONL fallback: read last N lines
    if (this._logFile && existsSync(this._logFile)) {
      try {
        const lines = readFileSync(this._logFile, 'utf-8').trim().split('\n');
        let entries = lines
          .filter(Boolean)
          .map(line => { try { return JSON.parse(line); } catch { return null; } })
          .filter(Boolean);
        if (agent) entries = entries.filter(e => e.agent === agent);
        return entries.slice(-limit).reverse();
      } catch { return []; }
    }
    return [];
  }

  /**
   * Get cost summary for a time period
   */
  costs(since = 'today') {
    if (this.db) {
      const queries = {
        today: this.db.prepare(`
          SELECT COUNT(*) as messages, COALESCE(SUM(cost), 0) as total_cost,
            COALESCE(AVG(cost), 0) as avg_cost, tier, model
          FROM audit WHERE timestamp >= date('now') AND action = 'completion'
          GROUP BY tier, model ORDER BY total_cost DESC
        `),
        week: this.db.prepare(`
          SELECT COUNT(*) as messages, COALESCE(SUM(cost), 0) as total_cost,
            COALESCE(AVG(cost), 0) as avg_cost, tier, model
          FROM audit WHERE timestamp >= date('now', '-7 days') AND action = 'completion'
          GROUP BY tier, model ORDER BY total_cost DESC
        `),
        month: this.db.prepare(`
          SELECT COUNT(*) as messages, COALESCE(SUM(cost), 0) as total_cost,
            COALESCE(AVG(cost), 0) as avg_cost, tier, model
          FROM audit WHERE timestamp >= date('now', '-30 days') AND action = 'completion'
          GROUP BY tier, model ORDER BY total_cost DESC
        `)
      };
      return (queries[since] || queries.today).all();
    }

    // JSONL fallback: basic aggregation
    const entries = this.recent(1000).filter(e => e.action === 'completion');
    const now = Date.now();
    const windows = { today: 86400000, week: 604800000, month: 2592000000 };
    const window = windows[since] || windows.today;
    const filtered = entries.filter(e => now - new Date(e.timestamp).getTime() < window);
    return [{
      messages: filtered.length,
      total_cost: filtered.reduce((sum, e) => sum + (e.cost || 0), 0),
      avg_cost: filtered.length > 0 ? filtered.reduce((sum, e) => sum + (e.cost || 0), 0) / filtered.length : 0
    }];
  }

  /**
   * Get total costs for dashboard display
   */
  costSummary() {
    if (this.db) {
      return this.db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN timestamp >= date('now') THEN cost ELSE 0 END), 0) as today,
          COALESCE(SUM(CASE WHEN timestamp >= date('now', '-7 days') THEN cost ELSE 0 END), 0) as week,
          COALESCE(SUM(CASE WHEN timestamp >= date('now', '-30 days') THEN cost ELSE 0 END), 0) as month,
          COUNT(CASE WHEN timestamp >= date('now') THEN 1 END) as today_msgs,
          COUNT(CASE WHEN timestamp >= date('now', '-7 days') THEN 1 END) as week_msgs
        FROM audit
        WHERE action = 'completion'
      `).get();
    }

    // JSONL fallback
    const entries = this.recent(5000).filter(e => e.action === 'completion');
    const now = Date.now();
    const dayMs = 86400000;
    let today = 0, week = 0, month = 0, todayMsgs = 0, weekMsgs = 0;
    for (const e of entries) {
      const age = now - new Date(e.timestamp).getTime();
      const cost = e.cost || 0;
      if (age < dayMs) { today += cost; todayMsgs++; }
      if (age < 7 * dayMs) { week += cost; weekMsgs++; }
      if (age < 30 * dayMs) { month += cost; }
    }
    return { today, week, month, today_msgs: todayMsgs, week_msgs: weekMsgs };
  }

  /**
   * Get cost breakdown by channel
   */
  costsByChannel(period = 'today') {
    const dateFilter = {
      today: "date('now')",
      week: "date('now', '-7 days')",
      month: "date('now', '-30 days')"
    }[period] || "date('now')";

    if (this.db) {
      return this.db.prepare(`
        SELECT 
          channel,
          COUNT(*) as messages,
          COALESCE(SUM(cost), 0) as total_cost,
          COALESCE(AVG(cost), 0) as avg_cost
        FROM audit
        WHERE timestamp >= ${dateFilter}
          AND action = 'completion'
          AND channel != 'unknown'
        GROUP BY channel
        ORDER BY total_cost DESC
      `).all();
    }

    // JSONL fallback
    const entries = this.recent(5000).filter(e => 
      e.action === 'completion' && e.channel !== 'unknown'
    );
    const now = Date.now();
    const periodMs = { today: 86400000, week: 604800000, month: 2592000000 }[period] || 86400000;
    
    const byChannel = {};
    for (const e of entries) {
      const age = now - new Date(e.timestamp).getTime();
      if (age > periodMs) continue;
      
      const ch = e.channel || 'unknown';
      if (!byChannel[ch]) byChannel[ch] = { messages: 0, total_cost: 0 };
      byChannel[ch].messages++;
      byChannel[ch].total_cost += e.cost || 0;
    }
    
    return Object.entries(byChannel)
      .map(([channel, data]) => ({
        channel,
        messages: data.messages,
        total_cost: data.total_cost,
        avg_cost: data.total_cost / data.messages
      }))
      .sort((a, b) => b.total_cost - a.total_cost);
  }
}
