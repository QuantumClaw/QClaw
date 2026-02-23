/**
 * QuantumClaw Credential Manager
 *
 * AGEX-first credential management with local fallback.
 *
 * When AGEX Hub is running:
 *   - Credentials are acquired via AGEX protocol (AIDs, CLCs, Intent Manifests)
 *   - Automatic rotation via ARP (no manual token refresh ever)
 *   - Delegation to sub-agents via scope-reducing chains
 *   - Emergency revocation across all services in <60s
 *   - Full audit trail with cryptographic non-repudiation
 *
 * When AGEX Hub is NOT running:
 *   - Falls back to local SecretStore (AES-256-GCM encrypted)
 *   - Everything still works, just without lifecycle management
 *   - Reconnects to Hub automatically when it becomes available
 *
 * This is a drop-in replacement for SecretStore. Any code that calls
 * secrets.get('github_api_key') works identically regardless of backend.
 */

import { log } from './core/logger.js';
import { SecretStore } from './security/secrets.js';

// Map from QuantumClaw tool names to AGEX service IDs and scopes
const SERVICE_MAP = {
  // Provider API keys (these stay local - they're model provider keys, not service credentials)
  anthropic_api_key:  { local: true },
  openai_api_key:     { local: true },
  groq_api_key:       { local: true },
  openrouter_api_key: { local: true },
  google_api_key:     { local: true },
  xai_api_key:        { local: true },
  mistral_api_key:    { local: true },
  together_api_key:   { local: true },
  bedrock_api_key:    { local: true },
  azure_api_key:      { local: true },

  // Channel tokens (local - these are bot identities, not service credentials)
  telegram_bot_token: { local: true },
  discord_bot_token:  { local: true },
  slack_bot_token:    { local: true },

  // Cognee (local - infrastructure)
  cognee_token:         { local: true },
  cognee_refresh_token: { local: true },

  // Business tools (AGEX-managed when Hub is available)
  ghl_api_key: {
    serviceId: 'gohighlevel',
    scopes: ['contacts:read', 'contacts:write', 'calendars:read', 'pipelines:read', 'pipelines:write'],
    taskType: 'read_write',
    summary: 'CRM access for contact management, calendar, and pipeline operations'
  },
  notion_api_key: {
    serviceId: 'notion',
    scopes: ['pages:read', 'pages:write', 'databases:read'],
    taskType: 'read_write',
    summary: 'Read and write pages, manage databases'
  },
  stripe_api_key: {
    serviceId: 'stripe',
    scopes: ['customers:read', 'invoices:read', 'payments:read'],
    taskType: 'read',
    summary: 'Read customer and payment data for reporting'
  },
  github_api_key: {
    serviceId: 'github',
    scopes: ['repo:read', 'issues:write', 'pulls:read'],
    taskType: 'read_write',
    summary: 'Repository access for code review and issue management'
  },
  linear_api_key: {
    serviceId: 'linear',
    scopes: ['issues:read', 'issues:write'],
    taskType: 'read_write',
    summary: 'Issue tracking and sprint management'
  },
  hubspot_api_key: {
    serviceId: 'hubspot',
    scopes: ['contacts:read', 'deals:read'],
    taskType: 'read',
    summary: 'CRM data access for lead management'
  },
  airtable_api_key: {
    serviceId: 'airtable',
    scopes: ['bases:read', 'records:write'],
    taskType: 'read_write',
    summary: 'Database access for records management'
  },

  // Voice & media (AGEX-managed)
  elevenlabs_api_key: {
    serviceId: 'elevenlabs',
    scopes: ['tts:generate', 'voices:read'],
    taskType: 'read_write',
    summary: 'Text-to-speech generation'
  },
  deepgram_api_key: {
    serviceId: 'deepgram',
    scopes: ['transcription:realtime'],
    taskType: 'read',
    summary: 'Real-time speech recognition'
  },

  // Cloud (AGEX-managed)
  oracle_api_key: {
    serviceId: 'oracle-cloud',
    scopes: ['compute:read', 'database:read'],
    taskType: 'read',
    summary: 'Infrastructure monitoring and database queries'
  },
  aws_api_key: {
    serviceId: 'aws',
    scopes: ['s3:read', 'ec2:read', 'cloudwatch:read'],
    taskType: 'read',
    summary: 'Cloud infrastructure monitoring'
  }
};

export class CredentialManager {
  constructor(config, localSecrets) {
    this.config = config;
    this.localSecrets = localSecrets; // SecretStore instance (always available)
    this.agex = null;                 // AgexClient (available when Hub is running)
    this.agexAvailable = false;
    this.aid = null;
    this._reconnectTimer = null;
    this._hubUrl = config.agex?.hubUrl || process.env.AGEX_HUB_URL || 'https://hub.agexhq.com';
  }

  /**
   * Initialise. Try AGEX Hub, fall back to local.
   */
  async init() {
    // Local secrets always load first (guaranteed to work)
    await this.localSecrets.load();

    // Try AGEX Hub
    try {
      await this._connectHub();
    } catch (err) {
      log.debug(`AGEX Hub not available: ${err.message}`);
      log.info(`AGEX Hub offline — using local secrets (will auto-reconnect). Tried ${this._hubUrl}; see docs/AGEX_HUB_RAILWAY.md if Hub is on Railway.`);
      this._startReconnectLoop();
    }

    return this;
  }

  /**
   * Get a credential value. AGEX-first, local fallback.
   *
   * This is the main API. Drop-in compatible with SecretStore.get()
   */
  async get(key) {
    const mapping = SERVICE_MAP[key];

    // Keys marked as local always come from SecretStore
    if (!mapping || mapping.local) {
      return this.localSecrets.get(key);
    }

    // If AGEX is available, try to get via CLC
    if (this.agexAvailable && this.agex) {
      try {
        const cred = await this.agex.use(mapping.serviceId, mapping.scopes, {
          summary: mapping.summary,
          taskType: mapping.taskType
        });

        if (cred.value) {
          log.debug(`[AGEX] Credential for ${mapping.serviceId} via CLC ${cred.clc_id}`);
          return cred.value;
        }
      } catch (err) {
        log.debug(`[AGEX] Failed for ${key}: ${err.message} — falling back to local`);
      }
    }

    // Fallback to local secrets
    return this.localSecrets.get(key);
  }

  /**
   * Store a credential. Always goes to local store.
   * AGEX credentials are managed by the Hub, not stored locally.
   */
  set(key, value) {
    this.localSecrets.set(key, value);
  }

  /**
   * Check if a credential exists (in either backend)
   */
  has(key) {
    // Check local first (fastest)
    if (this.localSecrets.has(key)) return true;

    // If AGEX is available, check if we have an active CLC
    const mapping = SERVICE_MAP[key];
    if (mapping && !mapping.local && this.agexAvailable && this.agex) {
      // TODO: Check active CLCs in the AGEX client
      return false;
    }

    return false;
  }

  /**
   * Delete a credential from local store
   */
  delete(key) {
    this.localSecrets.delete(key);
  }

  /**
   * List all available credential keys
   */
  list() {
    return this.localSecrets.list();
  }

  /**
   * Resolve template strings like {{secrets.ghl_api_key}}
   * Uses AGEX for mapped services, local for everything else
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
        log.warn(`Secret "${key}" not found — template unresolved`);
      }
    }

    return result;
  }

  /**
   * Delegate credentials to a sub-agent
   * Only works with AGEX. Returns null if Hub is offline.
   */
  async delegate(key, childAid, subScopes, durationSeconds = 3600) {
    const mapping = SERVICE_MAP[key];
    if (!mapping || mapping.local) {
      log.warn(`Cannot delegate local-only credential: ${key}`);
      return null;
    }

    if (!this.agexAvailable || !this.agex) {
      log.warn('AGEX Hub offline — delegation not available');
      return null;
    }

    try {
      const result = await this.agex.delegate(mapping.serviceId, childAid, subScopes, durationSeconds);
      log.info(`[AGEX] Delegated ${mapping.serviceId} to ${childAid} (${subScopes.join(', ')})`);
      return result;
    } catch (err) {
      log.error(`[AGEX] Delegation failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Emergency revocation — revoke all AGEX credentials immediately
   */
  async emergencyRevoke(reason = 'manual_revocation') {
    if (!this.agexAvailable || !this.agex) {
      log.warn('AGEX Hub offline — cannot perform emergency revocation');
      return false;
    }

    try {
      await this.agex.releaseAll();
      log.warn(`[AGEX] Emergency revocation complete: ${reason}`);
      return true;
    } catch (err) {
      log.error(`[AGEX] Emergency revocation failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Get AGEX status for dashboard
   */
  status() {
    return {
      agexAvailable: this.agexAvailable,
      hubUrl: this._hubUrl,
      aidId: this.aid?.aid_id || null,
      trustTier: this.aid?.trust_tier || null,
      localSecrets: this.localSecrets.list().length,
      mode: this.agexAvailable ? 'agex' : 'local'
    };
  }

  /**
   * Shutdown — release all AGEX credentials gracefully
   */
  async shutdown() {
    if (this._reconnectTimer) clearInterval(this._reconnectTimer);

    if (this.agexAvailable && this.agex) {
      try {
        await this.agex.releaseAll();
        log.info('[AGEX] All credentials released');
      } catch (err) {
        log.debug(`[AGEX] Shutdown release failed: ${err.message}`);
      }
    }
  }

  // ─── AGEX Hub connection ─────────────────────────────

  async _connectHub() {
    const healthUrl = `${this._hubUrl.replace(/\/$/, '')}/health`;
    const healthRes = await fetch(healthUrl, {
      signal: AbortSignal.timeout(5000)
    });
    if (!healthRes.ok) throw new Error(`GET ${healthUrl} returned ${healthRes.status}`);

    // Import the SDK from npm
    let AgexClient;
    try {
      const sdk = await import('@agexhq/sdk');
      AgexClient = sdk.AgexClient;
    } catch (err) {
      throw new Error(`AGEX SDK not found. Run: npm install @agexhq/sdk (${err.message})`);
    }

    // Load or generate AID
    this.aid = await this._loadOrCreateAID(AgexClient);

    // Get private key
    const privateKey = this.localSecrets.get('agex_private_key');
    if (!privateKey) throw new Error('No AGEX private key found');

    // Create client
    this.agex = new AgexClient({
      hubUrl: this._hubUrl,
      aid: this.aid,
      privateKey
    });

    await this.agex.init();

    // Register AID with Hub if first time
    try {
      await this.agex.registerAID();
    } catch (err) {
      // AID_ALREADY_REGISTERED is fine
      if (!err.message?.includes('ALREADY_REGISTERED')) {
        log.debug(`[AGEX] AID registration: ${err.message}`);
      }
    }

    this.agexAvailable = true;

    // Stop reconnect loop
    if (this._reconnectTimer) {
      clearInterval(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    log.success(`[AGEX] Connected to Hub at ${this._hubUrl} (AID: ${this.aid.aid_id.slice(0, 8)}..., Tier ${this.aid.trust_tier})`);
  }

  async _loadOrCreateAID(AgexClient) {
    const { existsSync } = await import('fs');
    const { readFileSync, writeFileSync, mkdirSync } = await import('fs');
    const { join } = await import('path');

    const aidDir = join(this.config._dir, 'agex');
    const aidFile = join(aidDir, 'aid.json');

    // Load existing AID
    if (existsSync(aidFile)) {
      try {
        return JSON.parse(readFileSync(aidFile, 'utf-8'));
      } catch {
        log.warn('[AGEX] Corrupt AID file — regenerating');
      }
    }

    // Generate new AID
    const { aid, privateKey } = await AgexClient.generateAID({
      agentName: this.config.agent?.name || 'QClaw',
      agentType: 'orchestrator',
      capabilities: ['chat', 'skills', 'memory', 'web'],
      organisation: this.config.agent?.owner || 'QuantumClaw User',
      contact: this.config.agex?.contact || 'agent@localhost',
      jurisdiction: this.config.agex?.jurisdiction || 'GB'
    });

    // Save AID (public) and private key (encrypted in secrets store)
    if (!existsSync(aidDir)) mkdirSync(aidDir, { recursive: true });
    writeFileSync(aidFile, JSON.stringify(aid, null, 2));
    this.localSecrets.set('agex_private_key', privateKey);

    log.info(`[AGEX] Generated new AID: ${aid.aid_id.slice(0, 8)}... (Tier ${aid.trust_tier})`);
    return aid;
  }

  _startReconnectLoop() {
    if (this._reconnectTimer) return;

    this._reconnectTimer = setInterval(async () => {
      try {
        await this._connectHub();
        log.success('[AGEX] Hub reconnected');
      } catch {
        // Still down, try again next interval
      }
    }, 30000); // every 30 seconds
  }
}
