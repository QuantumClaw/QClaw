/**
 * QuantumClaw Delivery Queue
 *
 * Messages that fail to send get queued for retry.
 * Uses shared database from @agexhq/store (sql.js on Termux, better-sqlite3 on server).
 * Falls back to JSON if no database is available.
 */

import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { log } from '../core/logger.js';

export class DeliveryQueue {
  constructor(config) {
    const dir = config._dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this._timer = null;
    this._dir = dir;
    this._jsonPath = join(dir, 'delivery-queue.json');
    this.db = null;
    this._useJson = true;
  }

  /** Call after construction with the shared db instance */
  attach(db) {
    if (db) {
      this.db = db;
      this._useJson = false;
    } else {
      this._data = this._loadJson();
    }
  }

  _loadJson() {
    try { return JSON.parse(readFileSync(this._jsonPath, 'utf8')); }
    catch { return { nextId: 1, items: [] }; }
  }

  _saveJson() {
    writeFileSync(this._jsonPath, JSON.stringify(this._data, null, 2));
  }

  enqueue(channel, recipient, content, metadata = {}) {
    if (this._useJson) {
      if (!this._data) this._data = this._loadJson();
      const id = this._data.nextId++;
      this._data.items.push({
        id, channel, recipient, content,
        metadata: JSON.stringify(metadata),
        attempts: 0, max_attempts: 5,
        next_retry: new Date().toISOString(),
        created: new Date().toISOString(),
        status: 'pending'
      });
      this._saveJson();
    } else {
      this.db.prepare(`
        INSERT INTO delivery_queue (channel, recipient, content, metadata)
        VALUES (?, ?, ?, ?)
      `).run(channel, recipient, content, JSON.stringify(metadata));
    }
    log.debug(`Queued message for ${channel}/${recipient}`);
  }

  pending() {
    if (this._useJson) {
      if (!this._data) this._data = this._loadJson();
      const now = new Date().toISOString();
      return this._data.items.filter(i =>
        i.status === 'pending' && i.next_retry <= now && i.attempts < i.max_attempts
      ).slice(0, 20);
    }

    return this.db.prepare(`
      SELECT * FROM delivery_queue
      WHERE status = 'pending' AND next_retry <= datetime('now') AND attempts < max_attempts
      ORDER BY created ASC LIMIT 20
    `).all();
  }

  delivered(id) {
    if (this._useJson) {
      const item = this._data?.items?.find(i => i.id === id);
      if (item) { item.status = 'delivered'; this._saveJson(); }
    } else {
      this.db.prepare('UPDATE delivery_queue SET status = \'delivered\' WHERE id = ?').run(id);
    }
  }

  failed(id, error) {
    if (this._useJson) {
      const item = this._data?.items?.find(i => i.id === id);
      if (!item) return;
      item.attempts++;
      if (item.attempts >= item.max_attempts) {
        item.status = 'failed';
        log.warn(`Delivery permanently failed after ${item.attempts} attempts: ${error}`);
      } else {
        const backoff = Math.pow(2, item.attempts) * 60000;
        item.next_retry = new Date(Date.now() + backoff).toISOString();
      }
      this._saveJson();
    } else {
      const item = this.db.prepare('SELECT attempts, max_attempts FROM delivery_queue WHERE id = ?').get(id);
      if (!item) return;
      const attempts = item.attempts + 1;
      const backoff = Math.pow(2, attempts);
      if (attempts >= item.max_attempts) {
        this.db.prepare('UPDATE delivery_queue SET status = \'failed\', attempts = ? WHERE id = ?').run(attempts, id);
        log.warn(`Delivery permanently failed after ${attempts} attempts: ${error}`);
      } else {
        this.db.prepare(`UPDATE delivery_queue SET attempts = ?, next_retry = datetime('now', '+${backoff} minutes') WHERE id = ?`).run(attempts, id);
      }
    }
  }

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
    }, 30000);
  }

  stop() { if (this._timer) clearInterval(this._timer); }

  stats() {
    if (this._useJson) {
      const grouped = {};
      for (const item of (this._data?.items || [])) {
        if (!grouped[item.status]) grouped[item.status] = { status: item.status, count: 0, latest: item.created };
        grouped[item.status].count++;
      }
      return Object.values(grouped);
    }
    return this.db.prepare('SELECT status, COUNT(*) as count, MAX(created) as latest FROM delivery_queue GROUP BY status').all();
  }
}
