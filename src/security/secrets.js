/**
 * QuantumClaw Secret Store
 *
 * AES-256-GCM encrypted. Keys never appear in plaintext in any file.
 * Encryption key derived from config path.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { log } from '../core/logger.js';

const ALGORITHM = 'aes-256-gcm';
const ENCODING = 'hex';

export class SecretStore {
  constructor(config) {
    this.dir = config._dir;
    this.file = join(this.dir, '.secrets.enc');
    this.secrets = {};
    this.encryptionKey = null;
  }

  async load() {
    // Derive encryption key from config directory (stable across sessions)
    // Note: hostname() is unreliable on Android/proot — it can change between sessions
    // TODO: Future improvement — use a per-installation random machine key for stronger encryption
    //       This requires a migration path so existing secrets aren't lost on upgrade
    const salt = `qclaw-secrets-${this.dir}`;
    this.encryptionKey = scryptSync(salt, 'quantumclaw-v1', 32);

    if (!existsSync(this.file)) {
      this.secrets = {};
      return;
    }

    try {
      const raw = readFileSync(this.file, 'utf-8');
      const data = JSON.parse(raw);
      this.secrets = {};
      let decrypted = 0;

      for (const [key, encrypted] of Object.entries(data)) {
        try {
          this.secrets[key] = this._decrypt(encrypted);
          decrypted++;
        } catch {
          log.warn(`Could not decrypt secret "${key}" — run: qclaw onboard`);
        }
      }

      // If nothing decrypted, the encryption key changed — wipe and start fresh
      if (decrypted === 0 && Object.keys(data).length > 0) {
        log.warn('Secret store needs re-encryption. Clearing — re-run onboard.');
        this.secrets = {};
        try { unlinkSync(this.file); } catch { /* */ }
      }
    } catch {
      log.warn('Secret store corrupted. Starting fresh.');
      this.secrets = {};
    }
  }

  get(key) {
    return this.secrets[key] || null;
  }

  set(key, value) {
    this.secrets[key] = value;
    this._save();
  }

  delete(key) {
    delete this.secrets[key];
    this._save();
  }

  has(key) {
    return key in this.secrets;
  }

  list() {
    return Object.keys(this.secrets);
  }

  /**
   * Resolve template strings like {{secrets.ghl_api_key}}
   */
  resolve(template) {
    return template.replace(/\{\{secrets\.(\w+)\}\}/g, (match, key) => {
      const val = this.get(key);
      if (!val) {
        log.warn(`Secret "${key}" not found — template unresolved`);
        return match;
      }
      return val;
    });
  }

  _encrypt(plaintext) {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, this.encryptionKey, iv);
    let encrypted = cipher.update(plaintext, 'utf-8', ENCODING);
    encrypted += cipher.final(ENCODING);
    const tag = cipher.getAuthTag().toString(ENCODING);
    return { iv: iv.toString(ENCODING), encrypted, tag };
  }

  _decrypt({ iv, encrypted, tag }) {
    const decipher = createDecipheriv(
      ALGORITHM,
      this.encryptionKey,
      Buffer.from(iv, ENCODING)
    );
    decipher.setAuthTag(Buffer.from(tag, ENCODING));
    let decrypted = decipher.update(encrypted, ENCODING, 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }

  _save() {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

    const encrypted = {};
    for (const [key, value] of Object.entries(this.secrets)) {
      encrypted[key] = this._encrypt(value);
    }

    // Atomic write: temp file then rename
    const tmpFile = this.file + '.tmp';
    writeFileSync(tmpFile, JSON.stringify(encrypted, null, 2));
    renameSync(tmpFile, this.file);
  }
}
