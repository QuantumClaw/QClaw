/**
 * Slice 4 — minimal writer for the SAME channel-events.log stream that
 * src/channels/manager.js (Slice 3e) writes to. Used by the verification-gate
 * escalation path in src/agents/registry.js so gate escalations sit beside
 * runner errors in one diagnostic surface (design §9 — not a parallel stream).
 *
 * manager.js's `_appendChannelEvent` isn't exported and importing manager.js
 * would pull the grammY runner into the agent core, so this is a tiny
 * standalone appender to the same path/format. Scrubs via the unanchored
 * Slice-3g scrubber (free-form claim text). Never throws.
 */

import { appendFileSync, chmodSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { log } from '../core/logger.js';
import { scrubSecrets } from './anthropic-spend-poller.js';

function _path() {
  return process.env.QCLAW_CHANNEL_EVENTS_LOG_PATH
    || join(homedir(), '.quantumclaw', 'channel-events.log');
}

/** Append one JSONL channel event ({ts, event, ...}); string fields scrubbed. Best-effort. */
export function appendChannelEvent(record = {}) {
  try {
    const path = _path();
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const scrubbed = {};
    for (const [k, v] of Object.entries({ ts: new Date().toISOString(), ...record })) {
      scrubbed[k] = typeof v === 'string' ? scrubSecrets(v) : v;
    }
    const existed = existsSync(path);
    appendFileSync(path, JSON.stringify(scrubbed) + '\n');
    if (!existed) { try { chmodSync(path, 0o600); } catch { /* non-fatal */ } }
  } catch (err) {
    try { log.warn?.(`channel-events append failed: ${err.message}`); } catch { /* swallow */ }
  }
}
