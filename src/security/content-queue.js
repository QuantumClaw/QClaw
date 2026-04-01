/**
 * ContentQueue — queues outbound content for review/filtering.
 * Scans for secrets, PII, and VALUES.md violations before delivery.
 */

import { log } from '../core/logger.js';

export class ContentQueue {
  constructor(config = {}) {
    this.filters = [];
    this._queue = [];
  }

  addFilter(fn) {
    this.filters.push(fn);
  }

  async process(content, meta = {}) {
    for (const filter of this.filters) {
      try {
        const result = await filter(content, meta);
        if (result && result.blocked) {
          log.warn(`ContentQueue: blocked by filter — ${result.reason || 'no reason'}`);
          return { delivered: false, reason: result.reason };
        }
        if (result && result.modified) {
          content = result.content;
        }
      } catch (err) {
        log.error(`ContentQueue: filter error — ${err.message}`);
      }
    }
    return { delivered: true, content };
  }
}
