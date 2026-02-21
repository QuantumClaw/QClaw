/**
 * @agex/sdk — AGEX Agent SDK (vendored into QuantumClaw)
 * Autonomous credential lifecycle management for AI agents
 *
 * Usage:
 *   import { AgexClient } from './agex-sdk/index.js'
 *
 *   const agex = new AgexClient({
 *     hubUrl:       'https://hub.agexhq.com',
 *     aidPath:      './aid.json',
 *     privateKey:   process.env.AGEX_PRIVATE_KEY
 *   })
 *
 *   const cred = await agex.use('github-api', ['repo:read'], {
 *     summary: 'Read repository metadata for analysis',
 *     taskType: 'read'
 *   })
 *   console.log(cred.value) // decrypted API key/token
 *
 *   await agex.release('github-api')
 */

import * as ed from '@noble/ed25519'
import { base64url } from 'jose'
import { v4 as uuidv4 } from 'uuid'
import { readFile } from 'fs/promises'
import { canonicalJson, sha3Hash } from './crypto.js'

export class AgexClient {
  #config
  #aid = null
  #privateKey = null
  #clcs = new Map()           // serviceId -> CLC
  #rotationTimers = new Map() // serviceId -> timer

  constructor (config = {}) {
    this.#config = {
      hubUrl:      config.hubUrl      || process.env.AGEX_HUB_URL || 'http://localhost:3000',
      aidPath:     config.aidPath     || process.env.AGEX_AID_PATH,
      privateKey:  config.privateKey  || process.env.AGEX_PRIVATE_KEY,
      aid:         config.aid         || null,
      ...config
    }
  }

  // ── Initialisation ────────────────────────────────────────────────────────

  async init () {
    if (this.#config.aid) {
      this.#aid = this.#config.aid
    } else if (this.#config.aidPath) {
      const raw = await readFile(this.#config.aidPath, 'utf-8')
      this.#aid = JSON.parse(raw)
    } else {
      throw new Error('AgexClient requires either aid or aidPath in config')
    }

    if (!this.#config.privateKey) {
      throw new Error('AgexClient requires privateKey in config or AGEX_PRIVATE_KEY env var')
    }

    this.#privateKey = this.#config.privateKey
    return this
  }

  // ── High-level task API ───────────────────────────────────────────────────

  async use (serviceId, scopes, intentOptions = {}) {
    await this.#ensureInit()

    const existing = this.#clcs.get(serviceId)
    if (existing && this.#isActive(existing)) {
      return this.#credentialValue(existing)
    }

    const clc = await this.acquire(serviceId, scopes, intentOptions)
    this.#scheduleRotation(serviceId, clc)
    return this.#credentialValue(clc)
  }

  async withCredential (serviceId, scopes, intentOptions = {}) {
    const cred = await this.use(serviceId, scopes, intentOptions)
    return {
      ...cred,
      done: () => this.release(serviceId)
    }
  }

  async release (serviceId) {
    const clc = this.#clcs.get(serviceId)
    if (!clc) return

    const timer = this.#rotationTimers.get(serviceId)
    if (timer) { clearTimeout(timer); this.#rotationTimers.delete(serviceId) }

    try {
      await this.#request('POST', '/agex/v1/ers/signal', {
        target_aid: this.#aid.aid_id,
        reason:     'voluntary_release',
        clc_ids:    [clc.clc_id]
      })
    } catch (err) {
      console.warn(`[AGEX] ERS release failed for ${serviceId}:`, err.message)
    }

    this.#clcs.delete(serviceId)
  }

  async releaseAll () {
    const allClcIds = Array.from(this.#clcs.values()).map(c => c.clc_id)

    for (const timer of this.#rotationTimers.values()) clearTimeout(timer)
    this.#rotationTimers.clear()

    if (allClcIds.length > 0) {
      try {
        await this.#request('POST', '/agex/v1/ers/signal', {
          target_aid: this.#aid.aid_id,
          reason:     'agent_shutdown',
          clc_ids:    allClcIds
        })
      } catch (err) {
        console.warn('[AGEX] releaseAll ERS failed:', err.message)
      }
    }

    this.#clcs.clear()
  }

  // ── Lifecycle management ──────────────────────────────────────────────────

  async acquire (serviceId, scopes, intentOptions = {}) {
    await this.#ensureInit()

    const manifest = this.#buildManifest(serviceId, scopes, intentOptions)
    const body = await this.#request('POST', '/agex/v1/credentials/request', manifest)

    if (body.status === 'rejected') {
      throw new Error(`Credential request rejected: ${body.reason}`)
    }

    if (body.status === 'pending_approval') {
      return await this.#pollApproval(body.approval_token, body.poll_url)
    }

    const clc = body.clc
    this.#clcs.set(serviceId, clc)
    return clc
  }

  async rotate (serviceId) {
    const clc = this.#clcs.get(serviceId)
    if (!clc) throw new Error(`No active CLC for service: ${serviceId}`)

    const newPrivKey = ed.utils.randomPrivateKey()
    const newPubKey  = ed.getPublicKeySync(newPrivKey)
    const newJWK = { kty: 'OKP', crv: 'Ed25519', x: base64url.encode(newPubKey) }

    const body = await this.#request('POST', '/agex/v1/credentials/rotate', {
      clc_id: clc.clc_id,
      new_public_key: newJWK
    })

    if (body.status === 'rotated') {
      this.#clcs.set(serviceId, body.new_clc)
      this.#scheduleRotation(serviceId, body.new_clc)
      return body.new_clc
    }

    throw new Error('Rotation failed: ' + (body.message || 'unknown error'))
  }

  async delegate (serviceId, childAid, subScopes, maxDurationSeconds = 3600) {
    const clc = this.#clcs.get(serviceId)
    if (!clc) throw new Error(`No active CLC for service: ${serviceId}`)

    const body = await this.#request('POST', '/agex/v1/credentials/delegate', {
      parent_clc_id:       clc.clc_id,
      child_aid:           childAid,
      requested_sub_scopes: subScopes,
      max_duration_seconds: maxDurationSeconds
    })

    return body
  }

  // ── AID Management ────────────────────────────────────────────────────────

  async registerAID () {
    await this.#ensureInit()
    return this.#request('POST', '/agex/v1/aids/register', this.#aid)
  }

  async getCredentials () {
    await this.#ensureInit()
    return this.#request('GET', '/agex/v1/credentials')
  }

  async getAuditLog (options = {}) {
    await this.#ensureInit()
    const params = new URLSearchParams(options).toString()
    return this.#request('GET', `/agex/v1/audit/events${params ? '?' + params : ''}`)
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  static async generateAID (options = {}) {
    const { generateKeypair } = await import('./crypto.js')
    const keypair = generateKeypair()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)

    const aid = {
      aid_version: '1.0',
      aid_id:      uuidv4(),
      issuer: {
        ia_id:      options.iaId      || 'self-signed-dev',
        ia_name:    options.iaName    || 'Self-Signed Development IA',
        ia_cert_id: options.iaCertId  || uuidv4()
      },
      issued_at:  now.toISOString(),
      expires_at: expiresAt.toISOString(),
      agent: {
        name:         options.agentName || 'AGEX Agent',
        type:         options.agentType || 'worker',
        capabilities: options.capabilities || [],
        principal: {
          organisation: options.organisation || 'AGEX Development',
          org_id:       options.orgId        || uuidv4(),
          contact:      options.contact      || 'dev@agexhq.com',
          jurisdiction: options.jurisdiction || 'GB'
        }
      },
      trust_tier:  options.trustTier || 0,
      public_key:  keypair.jwk,
      restrictions: options.restrictions || {},
      ia_signature: 'self-signed-dev-not-for-production'
    }

    return { aid, privateKey: keypair.privateKey, publicKey: keypair.publicKey }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  async #ensureInit () {
    if (!this.#aid) await this.init()
  }

  #buildManifest (serviceId, scopes, options = {}) {
    return {
      manifest_version: '1.0',
      manifest_id:      uuidv4(),
      requesting_aid:   this.#aid.aid_id,
      target: {
        service_id:       serviceId,
        requested_scopes: Array.isArray(scopes) ? scopes : [scopes],
        environment:      options.environment || 'production'
      },
      intent: {
        summary:             options.summary  || 'Automated agent task',
        task_type:           options.taskType || 'read',
        data_classification: options.dataClassification || 'internal',
        automated:           true,
        reversible:          options.reversible !== false,
        human_visible:       options.humanVisible || false
      },
      duration: {
        max_duration_seconds: options.maxDurationSeconds  || 3600,
        idle_timeout_seconds: options.idleTimeoutSeconds  || 1800
      },
      data_handling: {
        pii_processing:         options.piiProcessing        || false,
        cross_border_transfer:  options.crossBorderTransfer  || false,
        deletion_on_completion: options.deletionOnCompletion || false
      },
      agent_signature: 'sdk-placeholder' // TODO: real Ed25519 sig in v1.1
    }
  }

  async #request (method, path, body = null) {
    const requestId = uuidv4()
    const timestamp = new Date().toISOString()

    const bodyStr   = body ? canonicalJson(body) : ''
    const sigInput  = `${bodyStr}|${timestamp}|${requestId}`
    const signature = await this.#sign(sigInput)

    const headers = {
      'Content-Type':       'application/json',
      'X-AGEX-Version':     '1.0',
      'X-AGEX-Request-ID':  requestId,
      'X-AGEX-Timestamp':   timestamp,
      'X-AGEX-AID':         this.#aid?.aid_id || 'unregistered',
      'X-AGEX-Signature':   signature
    }

    const res = await fetch(`${this.#config.hubUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })

    const json = await res.json()
    if (!res.ok) {
      const err = new Error(json.message || json.error || `HTTP ${res.status}`)
      err.code = json.error
      err.status = res.status
      throw err
    }

    return json
  }

  async #sign (message) {
    try {
      const privBytes = base64url.decode(this.#privateKey)
      const msgBytes  = new TextEncoder().encode(message)
      const sig = await ed.signAsync(msgBytes, privBytes)
      return base64url.encode(sig)
    } catch {
      return 'sdk-dev-sig'
    }
  }

  async #pollApproval (token, pollUrl, maxWaitMs = 5 * 60 * 1000) {
    const start = Date.now()
    const interval = 5000

    while (Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, interval))

      try {
        const body = await this.#request('GET', pollUrl)
        if (body.status === 'approved') return body.clc
        if (body.status === 'rejected') throw new Error('Request rejected by human approver')
      } catch (err) {
        if (err.code === 'APPROVAL_EXPIRED') throw new Error('Approval request expired')
        throw err
      }
    }

    throw new Error('Approval polling timed out')
  }

  #scheduleRotation (serviceId, clc) {
    const existing = this.#rotationTimers.get(serviceId)
    if (existing) clearTimeout(existing)

    const rotationInterval = clc.rotation_policy?.rotation_interval_seconds || 86400
    const overlapSeconds   = clc.rotation_policy?.rotation_overlap_seconds  || 300
    const rotateAfterMs    = (rotationInterval - overlapSeconds) * 1000

    if (rotateAfterMs > 0) {
      const timer = setTimeout(async () => {
        try {
          console.log(`[AGEX] Initiating ARP rotation for ${serviceId}`)
          await this.rotate(serviceId)
        } catch (err) {
          console.error(`[AGEX] Rotation failed for ${serviceId}:`, err.message)
          setTimeout(() => this.rotate(serviceId).catch(console.error), 60_000)
        }
      }, rotateAfterMs)

      this.#rotationTimers.set(serviceId, timer)
    }
  }

  #isActive (clc) {
    if (!clc) return false
    const now = new Date()
    return clc.status !== 'revoked' &&
      new Date(clc.validity?.not_before || clc.not_before) <= now &&
      new Date(clc.validity?.not_after  || clc.not_after)  >  now
  }

  #credentialValue (clc) {
    return {
      value:      clc.credential_envelope?.ciphertext || null,
      clc_id:     clc.clc_id,
      scopes:     clc.granted_scopes,
      expires_at: clc.validity?.not_after || clc.not_after
    }
  }
}

export { generateKeypair, canonicalJson, sha3Hash } from './crypto.js'
