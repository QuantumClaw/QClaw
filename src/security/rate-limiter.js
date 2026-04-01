/**
 * RateLimiter — per-channel, per-agent rate limiting.
 * In-memory sliding window. Resets on restart.
 */

import { log } from '../core/logger.js';

export class RateLimiter {
  constructor(config = {}) {
    this.windowMs = config.windowMs || 60_000;
    this.maxRequests = config.maxRequests || 30;
    this._windows = new Map();
  }

  _key(channel, userId) {
    return `${channel}:${userId || 'anon'}`;
  }

  check(channel, userId) {
    const key = this._key(channel, userId);
    const now = Date.now();

    if (!this._windows.has(key)) {
      this._windows.set(key, []);
    }

    const timestamps = this._windows.get(key).filter(t => now - t < this.windowMs);
    this._windows.set(key, timestamps);

    if (timestamps.length >= this.maxRequests) {
      log.warn(`RateLimiter: limit hit for ${key} (${timestamps.length}/${this.maxRequests})`);
      return { allowed: false, retryAfter: Math.ceil((timestamps[0] + this.windowMs - now) / 1000) };
    }

    timestamps.push(now);
    return { allowed: true, remaining: this.maxRequests - timestamps.length };
  }

  reset(channel, userId) {
    this._windows.delete(this._key(channel, userId));
  }
}
