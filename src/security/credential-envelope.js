/**
 * QuantumClaw — Credential Envelope
 *
 * A scoped, time-bounded credential wrapper used for AGEX credential delegation.
 *
 * When AGEX Hub is online:
 *   - Envelope wraps a CLC-issued credential with enforced scope and TTL
 *   - clcId links back to the Hub for audit and revocation
 *
 * When AGEX Hub is offline:
 *   - Envelope wraps a local secret with advisory scope and TTL
 *   - Same interface — consuming code doesn't know the difference
 *
 * Envelopes are issued by CredentialManager.issueEnvelope() and consumed
 * by ScopedSecretProxy, which sub-agents and skills receive instead of
 * the raw credential manager.
 */

import { log } from '../core/logger.js';

export class CredentialEnvelope {
  /**
   * @param {Object} opts
   * @param {string} opts.key        - Secret key name (e.g. 'ghl_api_key')
   * @param {string} opts.value      - The credential value
   * @param {string[]} opts.scopes   - Granted scopes (e.g. ['contacts:read'])
   * @param {number} opts.expiresAt  - Unix timestamp (ms) when this envelope expires
   * @param {string} opts.issuedTo   - Child AID id (or agent name for local)
   * @param {string} opts.issuedBy   - Parent AID id (or 'local')
   * @param {string|null} opts.clcId - AGEX CLC id (null for local envelopes)
   * @param {string} opts.source     - 'agex' | 'local'
   * @param {string} opts.serviceId  - AGEX service identifier (e.g. 'gohighlevel')
   */
  constructor({ key, value, scopes, expiresAt, issuedTo, issuedBy, clcId = null, source = 'local', serviceId = null }) {
    this.key = key;
    this._value = value;
    this.scopes = Object.freeze([...(scopes || [])]);
    this.expiresAt = expiresAt;
    this.issuedAt = Date.now();
    this.issuedTo = issuedTo;
    this.issuedBy = issuedBy;
    this.clcId = clcId;
    this.source = source;
    this.serviceId = serviceId;
  }

  /**
   * Get the credential value. Throws if expired.
   */
  getValue() {
    if (this.isExpired()) {
      const ago = Math.round((Date.now() - this.expiresAt) / 1000);
      throw new Error(
        `Credential envelope expired ${ago}s ago (key=${this.key}, issuedTo=${this.issuedTo})`
      );
    }
    return this._value;
  }

  /**
   * Check if this envelope has expired.
   */
  isExpired() {
    return Date.now() > this.expiresAt;
  }

  /**
   * Check if a specific scope is granted by this envelope.
   */
  hasScope(scope) {
    // Wildcard — envelope grants everything
    if (this.scopes.includes('*')) return true;
    // Exact match
    if (this.scopes.includes(scope)) return true;
    // Prefix match (e.g. 'contacts:read' matches 'contacts:*')
    const [resource] = scope.split(':');
    return this.scopes.includes(`${resource}:*`);
  }

  /**
   * Remaining TTL in seconds (0 if expired).
   */
  get ttlSeconds() {
    return Math.max(0, Math.round((this.expiresAt - Date.now()) / 1000));
  }

  /**
   * Serialise for audit logging (never includes the credential value).
   */
  toJSON() {
    return {
      key: this.key,
      scopes: [...this.scopes],
      expiresAt: this.expiresAt,
      issuedAt: this.issuedAt,
      issuedTo: this.issuedTo,
      issuedBy: this.issuedBy,
      clcId: this.clcId,
      source: this.source,
      serviceId: this.serviceId,
      expired: this.isExpired(),
      ttlSeconds: this.ttlSeconds,
    };
  }

  /**
   * Create a local envelope wrapping a raw secret value.
   * Used as fallback when AGEX Hub is offline.
   */
  static local({ key, value, scopes, issuedTo, issuedBy = 'local', durationMs = 3600_000, serviceId = null }) {
    return new CredentialEnvelope({
      key,
      value,
      scopes: scopes || ['*'],
      expiresAt: Date.now() + durationMs,
      issuedTo,
      issuedBy,
      clcId: null,
      source: 'local',
      serviceId,
    });
  }

  /**
   * Create an AGEX-backed envelope from a CLC delegation result.
   */
  static fromCLC({ key, clcResult, scopes, issuedTo, issuedBy, durationMs = 3600_000, serviceId = null }) {
    return new CredentialEnvelope({
      key,
      value: clcResult.value,
      scopes: scopes || clcResult.scopes || ['*'],
      expiresAt: clcResult.expires_at
        ? new Date(clcResult.expires_at).getTime()
        : Date.now() + durationMs,
      issuedTo,
      issuedBy,
      clcId: clcResult.clc_id || clcResult.id || null,
      source: 'agex',
      serviceId,
    });
  }
}
