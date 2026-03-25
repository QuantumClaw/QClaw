/**
 * QuantumClaw — Scoped Secret Proxy
 *
 * Drop-in replacement for CredentialManager / SecretStore that sub-agents
 * and skill executions receive instead of the real credential manager.
 *
 * Backed by CredentialEnvelope instances — enforces scope and TTL.
 * Same interface as SecretStore so all existing code works unchanged.
 *
 * Sub-agents cannot modify, delete, or list credentials outside their scope.
 */

import { log } from '../core/logger.js';

export class ScopedSecretProxy {
  /**
   * @param {CredentialEnvelope[]} envelopes - Granted credential envelopes
   * @param {Object} [localSecrets]          - SecretStore for local-only keys (provider API keys, bot tokens)
   * @param {string} [recipientId]           - Agent or skill name (for logging)
   */
  constructor(envelopes = [], localSecrets = null, recipientId = 'unknown') {
    // Index envelopes by key for O(1) lookup
    this._envelopes = new Map();
    for (const env of envelopes) {
      this._envelopes.set(env.key, env);
    }

    this._localSecrets = localSecrets;
    this._recipientId = recipientId;
  }

  /**
   * Get a credential value. Checks envelope first, then local fallback.
   *
   * Drop-in compatible with SecretStore.get() and CredentialManager.get()
   */
  async get(key) {
    // Check envelopes first
    const envelope = this._envelopes.get(key);
    if (envelope) {
      try {
        return envelope.getValue();
      } catch (err) {
        log.warn(`[ScopedProxy] ${this._recipientId}: ${err.message}`);
        return null;
      }
    }

    // Fall through to local secrets for keys not in envelopes
    // (provider API keys, bot tokens — these are always local)
    if (this._localSecrets) {
      const localVal = typeof this._localSecrets.get === 'function'
        ? this._localSecrets.get(key)
        : null;
      if (localVal) return localVal;
    }

    return null;
  }

  /**
   * Check if a credential exists in this proxy's scope.
   */
  has(key) {
    const envelope = this._envelopes.get(key);
    if (envelope && !envelope.isExpired()) return true;
    if (this._localSecrets?.has) return this._localSecrets.has(key);
    return false;
  }

  /**
   * List available credential keys (only those in scope).
   */
  list() {
    const keys = [];
    for (const [key, env] of this._envelopes) {
      if (!env.isExpired()) keys.push(key);
    }
    if (this._localSecrets?.list) {
      for (const k of this._localSecrets.list()) {
        if (!keys.includes(k)) keys.push(k);
      }
    }
    return keys;
  }

  /**
   * Set is not allowed on scoped proxies — sub-agents cannot store credentials.
   */
  set(_key, _value) {
    throw new Error(`ScopedSecretProxy: sub-agent "${this._recipientId}" cannot modify credentials`);
  }

  /**
   * Delete is not allowed on scoped proxies.
   */
  delete(_key) {
    throw new Error(`ScopedSecretProxy: sub-agent "${this._recipientId}" cannot delete credentials`);
  }

  /**
   * Resolve template strings like {{secrets.ghl_api_key}}
   * Uses envelopes for scoped keys, local for everything else.
   */
  async resolve(template) {
    const matches = template.matchAll(/\{\{secrets\.(\w+)\}\}/g);
    let result = template;

    for (const match of matches) {
      const key = match[1];
      const value = await this.get(key);
      if (value) {
        result = result.replace(match[0], value);
      } else {
        log.warn(`[ScopedProxy] ${this._recipientId}: secret "${key}" not found or expired`);
      }
    }

    return result;
  }

  /**
   * Get envelope metadata for a key (for audit logging).
   * Returns null if no envelope exists for the key.
   */
  getEnvelopeInfo(key) {
    const envelope = this._envelopes.get(key);
    return envelope ? envelope.toJSON() : null;
  }

  /**
   * Get all active (non-expired) envelopes.
   */
  activeEnvelopes() {
    const active = [];
    for (const env of this._envelopes.values()) {
      if (!env.isExpired()) active.push(env);
    }
    return active;
  }

  /**
   * Purge expired envelopes. Returns count of purged envelopes.
   */
  purgeExpired() {
    let purged = 0;
    for (const [key, env] of this._envelopes) {
      if (env.isExpired()) {
        this._envelopes.delete(key);
        purged++;
      }
    }
    if (purged > 0) {
      log.debug(`[ScopedProxy] ${this._recipientId}: purged ${purged} expired envelope(s)`);
    }
    return purged;
  }
}
