/**
 * QuantumClaw Exec Approvals
 *
 * Some actions need human approval before executing.
 * This tracks pending, approved, and denied requests.
 *
 * The Trust Kernel defines what needs approval.
 * This system manages the actual approval workflow.
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { log } from '../core/logger.js';

export class ExecApprovals {
  constructor(config) {
    const dir = config._dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(join(dir, 'approvals.db'));
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        risk_level TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'pending',
        requested TEXT DEFAULT (datetime('now')),
        resolved TEXT,
        resolved_by TEXT,
        reason TEXT
      );
    `);

    this.pendingCallbacks = new Map();
  }

  /**
   * Request approval for an action.
   * Returns a promise that resolves when approved/denied.
   */
  async request(agent, action, detail, riskLevel = 'medium') {
    const result = this.db.prepare(`
      INSERT INTO approvals (agent, action, detail, risk_level)
      VALUES (?, ?, ?, ?)
    `).run(agent, action, detail, riskLevel);

    const id = result.lastInsertRowid;
    log.warn(`Approval needed: [${id}] ${agent} wants to ${action}`);

    return new Promise((resolve, reject) => {
      this.pendingCallbacks.set(id, { resolve, reject });

      // Auto-deny after 10 minutes if no response
      setTimeout(() => {
        if (this.pendingCallbacks.has(id)) {
          this.deny(id, 'system', 'Timed out after 10 minutes');
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * Approve a pending request
   */
  approve(id, by = 'owner') {
    this.db.prepare(`
      UPDATE approvals SET status = 'approved', resolved = datetime('now'), resolved_by = ?
      WHERE id = ? AND status = 'pending'
    `).run(by, id);

    const cb = this.pendingCallbacks.get(id);
    if (cb) {
      cb.resolve({ approved: true, id });
      this.pendingCallbacks.delete(id);
    }

    log.success(`Approved: [${id}]`);
  }

  /**
   * Deny a pending request
   */
  deny(id, by = 'owner', reason = '') {
    this.db.prepare(`
      UPDATE approvals SET status = 'denied', resolved = datetime('now'), resolved_by = ?, reason = ?
      WHERE id = ? AND status = 'pending'
    `).run(by, reason, id);

    const cb = this.pendingCallbacks.get(id);
    if (cb) {
      cb.resolve({ approved: false, id, reason });
      this.pendingCallbacks.delete(id);
    }

    log.info(`Denied: [${id}] ${reason}`);
  }

  /**
   * Get pending approvals (for dashboard)
   */
  pending() {
    return this.db.prepare(`
      SELECT * FROM approvals WHERE status = 'pending' ORDER BY requested DESC
    `).all();
  }

  /**
   * Recent history (for dashboard/audit)
   */
  recent(limit = 20) {
    return this.db.prepare(`
      SELECT * FROM approvals ORDER BY id DESC LIMIT ?
    `).all(limit);
  }
}
