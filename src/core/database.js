/**
 * QuantumClaw — Shared Database
 *
 * Single database instance shared across all QClaw modules.
 * Uses @agexhq/store for cross-platform SQLite:
 *   - Server/desktop: better-sqlite3 (native, fast)
 *   - Termux/Android: sql.js (WASM, zero compilation)
 *
 * All QClaw tables live in one database file (~/.quantumclaw/qclaw.db).
 * AGEX tables live separately in their own database.
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { log } from './logger.js';

let _db = null;
let _ready = false;

const QCLAW_SCHEMA = `
  -- ── Delivery Queue ─────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS delivery_queue (
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
  CREATE INDEX IF NOT EXISTS idx_dq_status ON delivery_queue(status, next_retry);

  -- ── Completion Cache ───────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS completion_cache (
    hash TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    prompt_preview TEXT,
    response TEXT NOT NULL,
    tokens_saved INTEGER DEFAULT 0,
    cost_saved REAL DEFAULT 0,
    hits INTEGER DEFAULT 1,
    created TEXT DEFAULT (datetime('now')),
    expires TEXT,
    last_hit TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cc_expires ON completion_cache(expires);

  -- ── Exec Approvals ─────────────────────────────────────────────────
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

  -- ── Knowledge Store ────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS knowledge (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT DEFAULT 'conversation',
    confidence REAL DEFAULT 0.8,
    access_count INTEGER DEFAULT 0,
    created TEXT DEFAULT (datetime('now')),
    last_accessed TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge(type);

  -- ── Conversation History ───────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    channel TEXT,
    tokens INTEGER DEFAULT 0,
    created TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_msg_agent ON messages(agent, created);
`;

/**
 * Get the shared QClaw database.
 * Initialises on first call, returns cached instance after.
 */
export async function getDb(configDir) {
  if (_ready && _db) return _db;

  const dir = configDir || join((await import('os')).homedir(), '.quantumclaw');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const dbPath = join(dir, 'qclaw.db');

  try {
    // Use @agexhq/store for cross-platform SQLite
    const { createDb } = await import('@agexhq/store');
    _db = await createDb({ dbPath, schema: QCLAW_SCHEMA });
    _ready = true;
    log.debug(`Database ready (${_db.backend || 'unknown'} backend) at ${dbPath}`);
    return _db;
  } catch (err) {
    // Fallback: try better-sqlite3 directly (in case @agexhq/store isn't installed yet)
    try {
      const mod = await import('better-sqlite3');
      const Database = mod.default;
      if (typeof Database !== 'function') throw new Error('Not a constructor');
      const db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.exec(QCLAW_SCHEMA);
      _db = db;
      _ready = true;
      log.debug(`Database ready (native fallback) at ${dbPath}`);
      return _db;
    } catch {
      log.warn(`No SQLite available — modules will use JSON fallbacks`);
      return null;
    }
  }
}

/**
 * Close the shared database (call on shutdown)
 */
export function closeDb() {
  if (_db) {
    try { _db.close(); } catch {}
    _db = null;
    _ready = false;
  }
}
