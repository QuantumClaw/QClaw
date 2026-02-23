/**
 * QuantumClaw Exec Approvals
 *
 * Some actions need human approval before executing.
 * Uses shared database from @agexhq/store.
 * Falls back to JSON if no database is available.
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { log } from '../core/logger.js';

export class ExecApprovals {
  constructor(config) {
    const dir = config._dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.pendingCallbacks = new Map();
    this._jsonPath = join(dir, 'approvals.json');
    this.db = null;
    this._useJson = true;
  }

  attach(db) {
    if (db) { this.db = db; this._useJson = false; }
    else { this._data = this._loadJson(); }
  }

  _loadJson() {
    try { return JSON.parse(readFileSync(this._jsonPath, 'utf8')); }
    catch { return { nextId: 1, items: [] }; }
  }

  _saveJson() {
    if (this._data.items.length > 200) this._data.items = this._data.items.slice(-200);
    writeFileSync(this._jsonPath, JSON.stringify(this._data, null, 2));
  }

  async request(agent, action, detail, riskLevel = 'medium') {
    let id;
    if (this._useJson) {
      if (!this._data) this._data = this._loadJson();
      id = this._data.nextId++;
      this._data.items.push({ id, agent, action, detail, risk_level: riskLevel, status: 'pending', requested: new Date().toISOString(), resolved: null, resolved_by: null, reason: null });
      this._saveJson();
    } else {
      const result = this.db.prepare('INSERT INTO approvals (agent, action, detail, risk_level) VALUES (?, ?, ?, ?)').run(agent, action, detail, riskLevel);
      id = result.lastInsertRowid;
    }

    log.warn(`Approval needed: [${id}] ${agent} wants to ${action}`);

    return new Promise((resolve, reject) => {
      this.pendingCallbacks.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pendingCallbacks.has(id)) this.deny(id, 'system', 'Timed out after 10 minutes');
      }, 10 * 60 * 1000);
    });
  }

  approve(id, by = 'owner') {
    if (this._useJson) {
      const item = this._data?.items?.find(i => i.id === id && i.status === 'pending');
      if (item) { item.status = 'approved'; item.resolved = new Date().toISOString(); item.resolved_by = by; this._saveJson(); }
    } else {
      this.db.prepare('UPDATE approvals SET status = \'approved\', resolved = datetime(\'now\'), resolved_by = ? WHERE id = ? AND status = \'pending\'').run(by, id);
    }
    const cb = this.pendingCallbacks.get(id);
    if (cb) { cb.resolve({ approved: true, id }); this.pendingCallbacks.delete(id); }
    log.success(`Approved: [${id}]`);
  }

  deny(id, by = 'owner', reason = '') {
    if (this._useJson) {
      const item = this._data?.items?.find(i => i.id === id && i.status === 'pending');
      if (item) { item.status = 'denied'; item.resolved = new Date().toISOString(); item.resolved_by = by; item.reason = reason; this._saveJson(); }
    } else {
      this.db.prepare('UPDATE approvals SET status = \'denied\', resolved = datetime(\'now\'), resolved_by = ?, reason = ? WHERE id = ? AND status = \'pending\'').run(by, reason, id);
    }
    const cb = this.pendingCallbacks.get(id);
    if (cb) { cb.resolve({ approved: false, id, reason }); this.pendingCallbacks.delete(id); }
    log.info(`Denied: [${id}] ${reason}`);
  }

  pending() {
    if (this._useJson) return (this._data?.items || []).filter(i => i.status === 'pending').reverse();
    return this.db.prepare('SELECT * FROM approvals WHERE status = \'pending\' ORDER BY requested DESC').all();
  }

  recent(limit = 20) {
    if (this._useJson) return (this._data?.items || []).slice(-limit).reverse();
    return this.db.prepare('SELECT * FROM approvals ORDER BY id DESC LIMIT ?').all(limit);
  }
}
