/**
 * Slice 3h — Charlie liveness heartbeat WRITER (runs INSIDE quantumclaw).
 *
 * This is the proof-of-life signal, not the monitor. A lightweight 60s interval
 * (NO LLM, separate from the heartbeat.js task scheduler) writes a row to
 * Supabase `workflow_heartbeats` (workflow_id='charlie-liveness') via the
 * record_heartbeat() RPC using the service_role key. The OFF-HOST watcher
 * (n8n droplet cron, src/observability/liveness-watcher.js) reads staleness and
 * alerts — the monitor deliberately does not run here (hard constraint: a monitor
 * must not depend on the thing it monitors).
 *
 * Why this catches the 2026-06-03 stale-dump outage: the proof-of-life is the
 * writing process EXISTING. A stopped process writes nothing → the row goes stale
 * → the watcher alerts, regardless of what PM2's dump believes the desired state is.
 *
 * Design notes:
 *  - NO execution_id → every beat INSERTs a fresh row so created_at advances
 *    (the RPC upserts when execution_id is present, which would freeze the
 *    timestamp and defeat staleness detection).
 *  - created_at is stamped server-side (DB now()), so the qclaw clock is not a
 *    factor; the watcher uses Supabase's clock too (see liveness-watcher.js).
 *  - metadata.channel_status carries the 3e Telegram-resilience state so the
 *    watcher can detect class (b) "up but polling degraded".
 *  - Retention lives HERE (writer), not in the watcher: if Charlie is down no
 *    rows accrue, so growth stays bounded without coupling cleanup to the
 *    detector (adversarial-review MED#7).
 *  - Fully fail-safe: a failed beat never throws into the loop; the interval is
 *    unref()'d so it can't hold the process open at shutdown.
 *
 * Design ref: /tmp/slice3h_design.md.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getEnv } from '../core/env.js';
import { log } from '../core/logger.js';

export const LIVENESS_WORKFLOW_ID = 'charlie-liveness';

// Resolve the package version once for the diagnostic metadata (so alerts read
// "v1.3.4" not "v?"). Best-effort — never fatal.
let PKG_VERSION = null;
try { PKG_VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf-8')).version || null; } catch { /* */ }
const BEAT_MS = 60_000;
const RETENTION_EVERY_BEATS = 60;   // ~hourly
const RETENTION_HOURS = 24;

/** POST record_heartbeat() with the service_role key. Throws on non-2xx. */
export async function recordLivenessBeat({ url, key, status = 'success', metadata, fetchImpl = fetch }) {
  const res = await fetchImpl(`${url}/rest/v1/rpc/record_heartbeat`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_workflow_id: LIVENESS_WORKFLOW_ID,
      p_status: status,
      p_workflow_name: 'Charlie liveness (quantumclaw)',
      p_metadata: metadata,
    }),
  });
  if (!res.ok) throw new Error(`record_heartbeat HTTP ${res.status}`);
}

/** Best-effort retention: delete charlie-liveness rows older than RETENTION_HOURS. */
export async function pruneLivenessRows({ url, key, nowMs = Date.now(), fetchImpl = fetch }) {
  const cutoff = new Date(nowMs - RETENTION_HOURS * 3_600_000).toISOString();
  await fetchImpl(
    `${url}/rest/v1/workflow_heartbeats?workflow_id=eq.${LIVENESS_WORKFLOW_ID}&created_at=lt.${encodeURIComponent(cutoff)}`,
    { method: 'DELETE', headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
}

/**
 * Start the liveness heartbeat. Returns a stop() function.
 * @param getChannelStatus () => string|null  — current Telegram channel status (3e).
 */
export function startLivenessHeartbeat({
  env = getEnv(),
  getChannelStatus = null,
  version = null,
  fetchImpl = fetch,
  intervalMs = BEAT_MS,
  nowMs = () => Date.now(),
} = {}) {
  const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || null;
  if (!url || !key) {
    log.warn('[liveness] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — liveness heartbeat DISABLED (off-host watcher would false-alert; fix .env)');
    return () => {};
  }

  const startedAt = nowMs();
  let beats = 0;

  const beat = async () => {
    beats += 1;
    try {
      const channel_status = (typeof getChannelStatus === 'function' ? getChannelStatus() : null) || 'unknown';
      const metadata = {
        pid: process.pid,
        uptime_s: Math.round((nowMs() - startedAt) / 1000),
        version: version ?? PKG_VERSION,
        channel_status,
        polling_ok: channel_status === 'active',
        host: env.HOSTNAME || env.HOST || null,
      };
      await recordLivenessBeat({ url, key, status: 'success', metadata, fetchImpl });
    } catch (err) {
      // Never throw into the loop — a failed beat is itself a (mild) liveness
      // signal the watcher will surface as staleness if it persists.
      log.debug(`[liveness] beat failed (non-fatal): ${err.message}`);
    }
    if (beats % RETENTION_EVERY_BEATS === 0) {
      pruneLivenessRows({ url, key, nowMs: nowMs(), fetchImpl }).catch(() => {});
    }
  };

  beat(); // immediate first beat — arms the off-host monitor fast
  const timer = setInterval(beat, intervalMs);
  if (timer.unref) timer.unref();
  log.info(`[liveness] heartbeat started (${LIVENESS_WORKFLOW_ID}, every ${Math.round(intervalMs / 1000)}s)`);
  return () => clearInterval(timer);
}
