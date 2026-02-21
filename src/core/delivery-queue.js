/**
 * QuantumClaw Delivery Queue
 *
 * Messages that fail to send get queued for retry.
 * No silent drops. If it failed, it'll try again.
 *
 * SQLite-backed. Survives restarts.
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { log } from '../core/logger.js';

export class DeliveryQueue {
  constructor(config) {
    const dir = config._dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(join(dir, 'delivery-queue.db'));
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        recipient TEXT,
        content TEXT NOT NULL,
        metadata TEXT,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 5,
        next_retry TEXT DEFAULT (datetime('now')),
        created TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'pending'
      );
      CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status, next_retry);
    `);

    this._timer = null;
  }

  /**
   * Add a message to the delivery queue
   */
  enqueue(channel, recipient, content, metadata = {}) {
    this.db.prepare(`
      INSERT INTO queue (channel, recipient, content, metadata)
      VALUES (?, ?, ?, ?)
    `).run(channel, recipient, content, JSON.stringify(metadata));

    log.debug(`Queued message for ${channel}/${recipient}`);
  }

  /**
   * Get pending messages ready for retry
   */
  pending() {
    return this.db.prepare(`
      SELECT * FROM queue
      WHERE status = 'pending'
        AND next_retry <= datetime('now')
        AND attempts < max_attempts
      ORDER BY created ASC
      LIMIT 20
    `).all();
  }

  /**
   * Mark a message as delivered
   */
  delivered(id) {
    this.db.prepare(`
      UPDATE queue SET status = 'delivered' WHERE id = ?
    `).run(id);
  }

  /**
   * Mark a failed attempt and schedule retry with exponential backoff
   */
  failed(id, error) {
    const item = this.db.prepare('SELECT attempts, max_attempts FROM queue WHERE id = ?').get(id);
    if (!item) return;

    const attempts = item.attempts + 1;
    const backoffMinutes = Math.pow(2, attempts); // 2, 4, 8, 16, 32 min

    if (attempts >= item.max_attempts) {
      this.db.prepare(`
        UPDATE queue SET status = 'failed', attempts = ? WHERE id = ?
      `).run(attempts, id);
      log.warn(`Delivery permanently failed after ${attempts} attempts: ${error}`);
    } else {
      this.db.prepare(`
        UPDATE queue
        SET attempts = ?,
            next_retry = datetime('now', '+${backoffMinutes} minutes')
        WHERE id = ?
      `).run(attempts, id);
      log.debug(`Retry ${attempts}/${item.max_attempts} in ${backoffMinutes}min`);
    }
  }

  /**
   * Start the retry loop
   */
  startRetryLoop(sendFn) {
    this._timer = setInterval(async () => {
      const items = this.pending();
      for (const item of items) {
        try {
          await sendFn(item.channel, item.recipient, item.content, JSON.parse(item.metadata || '{}'));
          this.delivered(item.id);
        } catch (err) {
          this.failed(item.id, err.message);
        }
      }
    }, 30000); // check every 30 seconds
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
  }

  /**
   * Stats for dashboard
   */
  stats() {
    return this.db.prepare(`
      SELECT
        status,
        COUNT(*) as count,
        MAX(created) as latest
      FROM queue
      GROUP BY status
    `).all();
  }
}
