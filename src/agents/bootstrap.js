/**
 * Charlie 2.0 session bootstrap.
 *
 * One bootstrap per (telegramUserId, agentName) session, cached in
 * memory with a 30-minute TTL or until clearCache is called. Replaces
 * the per-message stateless prompt assembly that drove failure
 * patterns A (hallucinated context) and B (stale memory).
 *
 * Five layers loaded in order. Layers 1-4 are sequential and fail-soft
 * (a missing doc adds to `warnings` and the rest of the load
 * continues). Layer 5 fans 5 probes in parallel under a 5s per-probe
 * timeout via Promise.race.
 *
 * Locked design lives in CHARLIE_OVERHAUL.md — Component 1 + the
 * 2026-05-06 Slice 1 design lock. Audit at /tmp/slice1_bootstrap_audit.md.
 *
 * Observability: every fire appends a JSONL line then a markdown block
 * (separated by ---) to ~/.quantumclaw/bootstrap.log.
 */

import { existsSync, readFileSync, appendFileSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { log } from '../core/logger.js';

import { probe as probeN8n } from './probes/n8n.js';
import { probe as probeHeartbeat } from './probes/heartbeat-freshness.js';
import { probe as probePm2 } from './probes/pm2.js';
import { probe as probeSupabase } from './probes/supabase.js';
import { probe as probeMemory } from './probes/memory-layer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// src/agents/bootstrap.js → repo root is two levels up.
const REPO_ROOT = join(__dirname, '..', '..');

const TTL_MS = 30 * 60 * 1000;
const PROBE_TIMEOUT_MS = 5000;
const RECENT_BUILD_LOG_DAYS = 7;
const RECENT_BUILD_LOG_CAP = 50;

const PROBE_DEFS = [
  { name: 'n8n_reachable',       fn: probeN8n },
  { name: 'heartbeat_freshness', fn: probeHeartbeat },
  { name: 'pm2_processes',       fn: probePm2 },
  { name: 'supabase_reachable',  fn: probeSupabase },
  { name: 'memory_layer',        fn: probeMemory }
];

const _cache = new Map();   // key `${userId}:${agentName}` → { result, loaded_at }

function _key(userId, agentName) {
  return `${userId ?? 'anonymous'}:${agentName}`;
}

/**
 * Public: was this (user, agent) bootstrapped within the TTL?
 * Useful for first-fire detection at the channels layer (warning surfacing).
 */
export function isCached(userId, agentName) {
  const entry = _cache.get(_key(userId, agentName));
  return !!entry && (Date.now() - entry.loaded_at) < TTL_MS;
}

/**
 * Public: evict cached bootstrap for one user.
 * If `agentName` is omitted, evicts every entry whose key starts with `${userId}:`.
 */
export function clearCache(userId, agentName) {
  if (agentName) {
    return _cache.delete(_key(userId, agentName));
  }
  const prefix = `${userId ?? 'anonymous'}:`;
  let removed = 0;
  for (const k of [..._cache.keys()]) {
    if (k.startsWith(prefix)) { _cache.delete(k); removed++; }
  }
  return removed > 0;
}

/**
 * Public: clear every cached bootstrap. Reserved for tests / process-wide reset.
 */
export function clearAllCaches() {
  _cache.clear();
}

/**
 * Public: cache entry count (for tests / observability).
 */
export function cacheSize() {
  return _cache.size;
}

/**
 * Main interface.
 *
 * sessionContext:
 *   userId          (telegram user id; required)
 *   agentName       (string; required — e.g. 'charlie')
 *   services        (qclaw services bag — { audit, memory, trustKernel, ... })
 *   config          (qclaw config — needed for _dir, agent name lookups)
 *   options.force   (bool; bypass cache and reload)
 */
export async function bootstrap(sessionContext = {}) {
  const { userId, agentName, options = {} } = sessionContext;
  if (!agentName) throw new Error('bootstrap: agentName is required');

  const cacheKey = _key(userId, agentName);
  const now = Date.now();
  if (!options.force) {
    const cached = _cache.get(cacheKey);
    if (cached && (now - cached.loaded_at) < TTL_MS) {
      return cached.result;
    }
  }

  const result = await _runBootstrap(sessionContext, cacheKey);
  _cache.set(cacheKey, { result, loaded_at: now });

  // Best-effort observability append. Never throws.
  try { _appendLog(result, sessionContext.config); } catch (err) {
    log.debug?.(`bootstrap.log append failed: ${err.message}`);
  }

  return result;
}

/**
 * Public: format a BootstrapResult as the markdown summary that
 * /bootstrap-status replies with. Pure function — no IO.
 */
export function formatStatusMarkdown(result) {
  const lines = [];
  lines.push(`# Bootstrap status — ${result.agent_name}`);
  lines.push('');
  lines.push(`- user: \`${result.user_id ?? 'anonymous'}\``);
  lines.push(`- loaded_at: \`${result.loaded_at}\``);
  lines.push(`- warnings: ${result.warnings.length}`);
  lines.push('');

  lines.push('## Layer 1 — Identity');
  lines.push(`- soul: ${_present(result.identity.soul)}`);
  lines.push(`- values: ${_present(result.identity.values)}`);
  lines.push(`- identity_doc: ${_present(result.identity.identity_doc)}`);
  lines.push(`- ceo_operating_model: ${_present(result.identity.ceo_operating_model)}`);
  lines.push(`- charlie_role: ${_present(result.identity.charlie_role)}`);
  lines.push('');

  lines.push('## Layer 2 — State');
  lines.push(`- flow_os_state: ${_present(result.state.flow_os_state)}`);
  lines.push(`- recent_build_log: ${_present(result.state.recent_build_log)}`);
  lines.push('');

  lines.push('## Layer 3 — Specialists');
  lines.push(`- flow_os_specialists: ${_present(result.specialists.flow_os_specialists)}`);
  lines.push('');

  lines.push('## Layer 4 — Recent context');
  lines.push(`- memory: ${result.recent.memory.source} (${result.recent.memory.entries.length} entries)`);
  lines.push(`- audit_log: ${result.recent.audit_log.source} (${result.recent.audit_log.entries.length} entries)`);
  lines.push('');

  lines.push('## Layer 5 — Live probes');
  for (const p of result.probes) {
    const mark = p.ok ? '✓' : '✗';
    const tail = p.error ? ` — ${p.error}` : '';
    lines.push(`- ${mark} ${p.name} (${p.latency_ms}ms)${tail}`);
  }
  lines.push('');

  if (result.skills) {
    const alwaysOn = result.skills.always_on || [];
    const totalChars = alwaysOn.reduce((sum, s) => sum + (s.content?.length || 0), 0);
    lines.push('## Layer 6 — Skills (always-on)');
    lines.push(`- ${alwaysOn.length} skills, ~${(totalChars / 1024).toFixed(1)} KB total`);
    if (alwaysOn.length > 0) {
      lines.push(`- names: ${alwaysOn.map(s => s.name).join(', ')}`);
    }
    lines.push('');
  }

  if (result.warnings.length) {
    lines.push('## Warnings');
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── internals ─────────────────────────────────────────────────────────────

function _present(s) {
  if (s == null) return '✗ missing';
  return `✓ ${s.length} chars`;
}

async function _runBootstrap(sessionContext, cacheKey) {
  const { userId, agentName, services, config } = sessionContext;
  const warnings = [];

  const identity = await _layer1Identity(config, agentName, services, warnings);
  const state = await _layer2State(warnings);
  const specialists = await _layer3Specialists(warnings);
  const recent = await _layer4Recent(services, warnings);
  const probes = await _layer5Probes(services, warnings);
  const skills = await _layer6Skills(agentName, userId, warnings);

  return {
    agent_name: agentName,
    user_id: userId ?? null,
    loaded_at: new Date().toISOString(),
    cache_key: cacheKey,
    identity, state, specialists, recent, probes, skills, warnings
  };
}

/**
 * Layer 6 (Slice 2b Task 8) — always-on skills, session-cached.
 *
 * Calls loadSkills with an empty message, which by design returns only
 * the always-on portion (no on-demand matches against an empty token
 * list). Stored on bootstrap.skills.always_on; reused by
 * registry._buildSystemPrompt → loadSkills via context.bootstrap so
 * that 7 markdown files don't re-read on every message inside the
 * 30-min cache window.
 */
async function _layer6Skills(agentName, userId, warnings) {
  try {
    const { loadSkills } = await import('./skill-loader.js');
    const result = await loadSkills({ agent: agentName, message: '', userId });
    return { always_on: result.always_on };
  } catch (err) {
    warnings.push(`skills layer failed: ${err.message}`);
    return { always_on: [] };
  }
}

async function _layer1Identity(config, agentName, services, warnings) {
  // Workspace-rooted SOUL/IDENTITY (per audit T1 resolution: read from
  // existing paths, no promotion). VALUES comes from the loaded TrustKernel.
  const dir = config?._dir || join(homedir(), '.quantumclaw');
  const agentRoot = join(dir, 'workspace', 'agents', agentName);

  const soul = _safeRead(join(agentRoot, 'SOUL.md'), warnings, `SOUL.md missing for agent ${agentName}`);
  const identity_doc =
    _safeRead(join(agentRoot, 'IDENTITY.md'), null, null) ||
    _safeRead(join(dir, 'workspace', 'IDENTITY.md'), null, null) ||
    _safeRead(join(REPO_ROOT, 'workspace', 'IDENTITY.md'), null, null);
  if (identity_doc == null) warnings.push('IDENTITY.md not found in workspace or repo');

  // VALUES: prefer the loaded TrustKernel (already parsed at startup).
  // Fall back to direct file read for sandbox tests where services is absent.
  let values = services?.trustKernel?.raw || null;
  if (!values) {
    values =
      _safeRead(join(dir, 'VALUES.md'), null, null) ||
      _safeRead(join(REPO_ROOT, 'workspace', 'VALUES.md'), null, null);
  }
  if (values == null) warnings.push('VALUES.md not found in trust kernel or workspace');

  const ceo_operating_model = _safeRead(
    join(REPO_ROOT, 'CEO_OPERATING_MODEL.md'),
    warnings,
    'CEO_OPERATING_MODEL.md missing at repo root'
  );
  const charlie_role = _safeRead(
    join(REPO_ROOT, 'CHARLIE_ROLE.md'),
    warnings,
    'CHARLIE_ROLE.md missing at repo root'
  );

  return { soul, values, identity_doc, ceo_operating_model, charlie_role };
}

async function _layer2State(warnings) {
  const flow_os_state = _safeRead(
    join(REPO_ROOT, 'FLOW_OS_STATE.md'),
    warnings,
    'FLOW_OS_STATE.md missing at repo root'
  );

  const buildLog = _safeRead(join(REPO_ROOT, 'QCLAW_BUILD_LOG.md'), warnings, 'QCLAW_BUILD_LOG.md missing at repo root');
  const recent_build_log = buildLog ? _trimBuildLog(buildLog) : null;
  return { flow_os_state, recent_build_log };
}

async function _layer3Specialists(warnings) {
  const flow_os_specialists = _safeRead(
    join(REPO_ROOT, 'FLOW_OS_SPECIALISTS.md'),
    warnings,
    'FLOW_OS_SPECIALISTS.md missing at repo root'
  );
  return { flow_os_specialists };
}

async function _layer4Recent(services, warnings) {
  // Memory: the audit confirmed we read real data on the default path.
  let memory = { source: 'unavailable', entries: [] };
  if (services?.memory) {
    try {
      if (typeof services.memory.recentEntries === 'function') {
        const entries = services.memory.recentEntries({ since: '-24h', limit: 30 });
        const source = services.memory.cogneeConnected ? 'cognee' :
                       (services.memory.db ? 'sqlite' : 'vector');
        memory = { source, entries };
      } else {
        warnings.push('memory.recentEntries not available — Layer 4 memory empty');
      }
    } catch (err) {
      warnings.push(`Layer 4 memory read failed: ${err.message}`);
    }
  } else {
    warnings.push('services.memory unavailable — Layer 4 memory empty');
  }

  // Audit log: AuditLog.recent(limit) returns last N entries (newest first).
  // H3 fix (2026-05-14): cap at 30 to match recent.memory's limit (line ~305).
  // Layer 4 is now wired into _buildSystemPrompt; symmetric caps keep the
  // prompt budget predictable. Audit ref: /tmp/memory_drop_diagnostic_audit.md.
  let audit_log = { source: 'unavailable', entries: [] };
  if (services?.audit && typeof services.audit.recent === 'function') {
    try {
      const entries = services.audit.recent(30);
      const source = services.audit.db ? 'sqlite' : 'jsonl';
      audit_log = { source, entries };
    } catch (err) {
      warnings.push(`Layer 4 audit read failed: ${err.message}`);
    }
  } else {
    warnings.push('services.audit unavailable — Layer 4 audit log empty');
  }

  return { memory, audit_log };
}

async function _layer5Probes(services, warnings) {
  const ctx = {
    cogneeUrl: services?.memory?.cogneeUrl || null
  };
  const wrapped = PROBE_DEFS.map(({ name, fn }) =>
    _withTimeout(fn(ctx), PROBE_TIMEOUT_MS, name)
  );
  const settled = await Promise.allSettled(wrapped);
  const probes = settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      name: PROBE_DEFS[i].name,
      ok: false,
      latency_ms: PROBE_TIMEOUT_MS,
      error: s.reason?.message || String(s.reason)
    };
  });
  for (const p of probes) {
    if (!p.ok) warnings.push(`probe ${p.name} failed: ${p.error || 'no detail'}`);
  }
  return probes;
}

function _withTimeout(promise, ms, name) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
    )
  ]);
}

function _safeRead(path, warnings, missingMsg) {
  try {
    if (!existsSync(path)) {
      if (warnings && missingMsg) warnings.push(missingMsg);
      return null;
    }
    return readFileSync(path, 'utf-8');
  } catch (err) {
    if (warnings) warnings.push(`failed to read ${path}: ${err.message}`);
    return null;
  }
}

/**
 * Trim QCLAW_BUILD_LOG.md to the last RECENT_BUILD_LOG_DAYS days,
 * capped at RECENT_BUILD_LOG_CAP entries. Entries are H2 sections
 * (`^## YYYY-MM-DD …`).
 */
function _trimBuildLog(text) {
  const cutoffMs = Date.now() - RECENT_BUILD_LOG_DAYS * 24 * 60 * 60 * 1000;
  const lines = text.split('\n');
  const sections = [];
  let current = null;
  const dateRe = /^##\s+(?:\[)?(\d{4}-\d{2}-\d{2})/;
  for (const line of lines) {
    const m = line.match(dateRe);
    if (m) {
      if (current) sections.push(current);
      current = { date: m[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);

  const recent = sections.filter((s) => {
    const t = Date.parse(s.date);
    return Number.isFinite(t) && t >= cutoffMs;
  });
  const capped = recent.slice(-RECENT_BUILD_LOG_CAP);
  return capped.map((s) => s.lines.join('\n')).join('\n\n').trim() || null;
}

function _appendLog(result, config) {
  // Resolve log path from config?._dir (mirrors _layer1Identity at line 212),
  // so tests using a tmpdir _dir get isolated logs without mutating
  // process.env.HOME. Production callers omit _dir, falling back to
  // ~/.quantumclaw/bootstrap.log.
  const dir = config?._dir || join(homedir(), '.quantumclaw');
  const logPath = join(dir, 'bootstrap.log');

  // Strip large doc bodies before writing — keep the JSONL tractable.
  const compact = {
    loaded_at: result.loaded_at,
    agent_name: result.agent_name,
    user_id: result.user_id,
    cache_key: result.cache_key,
    identity_present: Object.fromEntries(
      Object.entries(result.identity).map(([k, v]) => [k, v != null])
    ),
    state_present: Object.fromEntries(
      Object.entries(result.state).map(([k, v]) => [k, v != null])
    ),
    specialists_present: Object.fromEntries(
      Object.entries(result.specialists).map(([k, v]) => [k, v != null])
    ),
    recent: {
      memory: { source: result.recent.memory.source, count: result.recent.memory.entries.length },
      audit_log: { source: result.recent.audit_log.source, count: result.recent.audit_log.entries.length }
    },
    probes: result.probes.map((p) => ({
      name: p.name, ok: p.ok, latency_ms: p.latency_ms,
      ...(p.error ? { error: p.error } : {})
    })),
    warnings: result.warnings
  };

  const block =
    JSON.stringify(compact) + '\n' +
    '---\n' +
    formatStatusMarkdown(result) + '\n' +
    '===\n';

  appendFileSync(logPath, block, { mode: 0o600 });
  // Best-effort: ensure the file is 0600 even if appendFileSync ignores mode
  // because the file already existed.
  try { chmodSync(logPath, 0o600); } catch { /* */ }
}
