/**
 * History isolation tests — H1 hotfix, 2026-05-14.
 *
 * Run: node tests/registry-history-isolation.test.js
 *
 * Locks in the channel + userId filter contract that
 * src/agents/registry.js _processNonReflex now relies on. Before this
 * fix, getHistory(agent, limit) returned the agent's most recent N
 * messages across all channels — so heartbeat / CLI / dashboard writes
 * could pollute a live Telegram conversation. The fix passes
 * { channel: context?.channel, userId: context?.userId } at
 * src/agents/registry.js:306.
 *
 * These tests exercise the underlying memory.getHistory filter path
 * (JSON-store fallback, same filter logic as the SQL path) to ensure
 * the contract holds.
 *
 * Audit ref: /tmp/memory_drop_diagnostic_audit.md
 */

import { MemoryManager } from '../src/memory/manager.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const tmp = mkdtempSync(join(tmpdir(), 'qclaw-history-iso-'));

// Construct a minimal MemoryManager backed by the JSON store. We skip
// the full connect() path (SQLite native module / Cognee / vector init)
// because we're testing the getHistory filter contract only.
const memory = new MemoryManager({ _dir: tmp }, {});
memory._jsonStore = { conversations: [], context: {} };
memory._jsonStorePath = join(tmp, 'memory.json');
memory._saveJsonStore = () => {}; // no-op for test

// Seed conversations across channels and users.
memory.addMessage('charlie', 'user',      'cli-msg-1',   { channel: 'cli',       userId: 'X' });
memory.addMessage('charlie', 'user',      'tg-msg-1',    { channel: 'telegram',  userId: 'X' });
memory.addMessage('charlie', 'assistant', 'tg-reply-1',  { channel: 'telegram',  userId: 'X' });
memory.addMessage('charlie', 'user',      'cli-msg-2',   { channel: 'cli',       userId: 'Y' });
memory.addMessage('charlie', 'user',      'tg-msg-2',    { channel: 'telegram',  userId: 'X' });
memory.addMessage('charlie', 'user',      'dash-msg-1',  { channel: 'dashboard', userId: 'X' });

// ─── Channel + userId filter (the H1 fix contract) ─────────────────────
const tgX = memory.getHistory('charlie', 20, { channel: 'telegram', userId: 'X' });
check('channel+userId filter returns only matching channel',
  tgX.length === 3 && tgX.every(m => m.channel === 'telegram'),
  `got: ${tgX.map(m => `${m.channel}:${m.userId}`).join(', ')}`);
check('channel+userId filter returns only matching userId',
  tgX.every(m => m.userId === 'X'));
check('channel+userId filter does NOT leak CLI entries with same userId',
  !tgX.some(m => m.channel === 'cli'));
check('channel+userId filter does NOT leak dashboard entries with same userId',
  !tgX.some(m => m.channel === 'dashboard'));
check('channel+userId filter does NOT leak other-user entries on same channel',
  !tgX.some(m => m.userId === 'Y'));

// ─── Channel-only filter (multi-user scenario) ─────────────────────────
const allTg = memory.getHistory('charlie', 20, { channel: 'telegram' });
check('channel-only filter returns all matching channel across users',
  allTg.length === 3 && allTg.every(m => m.channel === 'telegram'),
  `got: ${allTg.map(m => `${m.channel}:${m.userId}`).join(', ')}`);

// ─── userId-only filter (legacy callers that don't track channel) ──────
const allX = memory.getHistory('charlie', 20, { userId: 'X' });
check('userId-only filter returns all matching userId across channels',
  allX.length === 5 && allX.every(m => m.userId === 'X'),
  `got: ${allX.map(m => `${m.channel}:${m.userId}`).join(', ')}`);

// ─── Unfiltered call (heartbeat / auto-learn legitimate cross-channel) ──
const all = memory.getHistory('charlie', 20);
check('unfiltered call returns all agent messages (cross-channel)',
  all.length === 6, `got ${all.length} messages`);

// ─── Undefined-vs-missing options (heartbeat pattern parity) ───────────
// registry.js passes { channel: context?.channel, userId: context?.userId }
// where both keys are PRESENT but their values may be undefined for
// non-Telegram callers. Filter behaviour must match the unfiltered case.
const undefBoth = memory.getHistory('charlie', 20, { channel: undefined, userId: undefined });
check('undefined channel + undefined userId behaves like unfiltered',
  undefBoth.length === 6,
  `got ${undefBoth.length}; expected 6 (parity with unfiltered)`);

// ─── Limit honoured under filter ───────────────────────────────────────
const tgLimited = memory.getHistory('charlie', 2, { channel: 'telegram', userId: 'X' });
check('limit honoured alongside filter',
  tgLimited.length === 2 && tgLimited.every(m => m.channel === 'telegram'),
  `got ${tgLimited.length}`);

// ─── Cleanup ───────────────────────────────────────────────────────────
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
