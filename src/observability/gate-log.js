/**
 * Slice 4 — gate.log writer.
 *
 * One JSONL line per verification-gate firing. Append-only, mode 0600, path
 * `~/.quantumclaw/gate.log` (override `QCLAW_GATE_LOG_PATH`), size-based
 * rotation at 50 MB keeping one generation (`.1`) — matching the
 * cache-usage-log.js pattern.
 *
 * Claim/response text is free-form prose, so secrets are scrubbed with the
 * GLOBAL/UNANCHORED scrubber (a key can appear mid-string) reused from the
 * Slice 3g poller — NOT the anchored whole-value `_scrub` in cache-usage-log.js.
 *
 * Design ref: /tmp/slice4_design.md §8.
 */

import { existsSync, appendFileSync, chmodSync, statSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from '../core/logger.js';
import { scrubSecrets } from './anthropic-spend-poller.js';

const DEFAULT_PATH = join(homedir(), '.quantumclaw', 'gate.log');
const ROTATION_BYTES = 50 * 1024 * 1024;
const MODE = 0o600;

function _path() {
  return process.env.QCLAW_GATE_LOG_PATH || DEFAULT_PATH;
}

function _rotateIfNeeded(path) {
  try {
    if (!existsSync(path)) return;
    if (statSync(path).size <= ROTATION_BYTES) return;
    renameSync(path, path + '.1');
  } catch (err) {
    log.debug?.(`gate.log rotation failed: ${err.message}`);
  }
}

/**
 * Append one gate-firing record. Never throws (logging must not break the
 * regeneration loop). Scrubs `claim` + `rewritten_claim` before write.
 *
 * record: { gate, claim, verification_attempted, verified, result, action,
 *           attempt, rewritten_claim? }
 */
export function appendGateLog(record = {}) {
  const path = _path();
  try {
    _rotateIfNeeded(path);
    const entry = {
      ts: new Date().toISOString(),
      gate: record.gate || null,
      claim: record.claim != null ? scrubSecrets(String(record.claim)).slice(0, 500) : null,
      verification_attempted: !!record.verification_attempted,
      verified: !!record.verified,
      result: record.result || null,            // 'pass'|'soft_fail'|'hard_fail'
      action: record.action || null,            // 'rewrite'|'reprompt'|'escalate'|'fail_closed_slice5_pending'|...
      attempt: record.attempt ?? 0,
    };
    if (record.rewritten_claim != null) {
      entry.rewritten_claim = scrubSecrets(String(record.rewritten_claim)).slice(0, 500);
    }
    const existedBefore = existsSync(path);
    appendFileSync(path, JSON.stringify(entry) + '\n', { mode: MODE });
    if (!existedBefore) { try { chmodSync(path, MODE); } catch { /* defensive */ } }
  } catch (err) {
    log.debug?.(`gate.log append failed: ${err.message}`);
  }
}
