/**
 * Slice 3h — liveness writer + watcher tests.
 * Run: node tests/liveness-monitoring.test.js
 */
import { recordLivenessBeat, pruneLivenessRows, startLivenessHeartbeat, LIVENESS_WORKFLOW_ID } from '../src/observability/liveness-heartbeat.js';
import { parseEnvFile, classify, activeEpisode, reminderDue, readState, runWatcher } from '../src/observability/liveness-watcher.js';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let passed = 0, failed = 0;
function check(label, cond, detail = '') { if (cond) { console.log(`  ✓ ${label}`); passed++; } else { console.log(`  ✗ ${label} ${detail}`); failed++; } }
const dir = mkdtempSync(join(tmpdir(), 'liveness-'));
const STALE = 4 * 60_000;

// ── writer ──────────────────────────────────────────────────────────────────
console.log('liveness writer:');
{
  let captured = null;
  const fetchImpl = async (url, opts) => { captured = { url, body: JSON.parse(opts.body), headers: opts.headers }; return { ok: true, status: 200 }; };
  await recordLivenessBeat({ url: 'https://x.supabase.co', key: 'SVCKEY', status: 'success', metadata: { pid: 1, channel_status: 'active' }, fetchImpl });
  check('writer: posts to record_heartbeat RPC', captured.url.endsWith('/rest/v1/rpc/record_heartbeat'));
  check('writer: workflow_id = charlie-liveness', captured.body.p_workflow_id === LIVENESS_WORKFLOW_ID);
  check('writer: NO execution_id (insert-new so created_at advances)', !('p_execution_id' in captured.body) && captured.body.p_execution_id === undefined);
  check('writer: service key in auth headers', captured.headers.Authorization === 'Bearer SVCKEY' && captured.headers.apikey === 'SVCKEY');
  check('writer: metadata carries channel_status', captured.body.p_metadata.channel_status === 'active');
}
check('writer: throws on non-2xx', await recordLivenessBeat({ url: 'h', key: 'k', metadata: {}, fetchImpl: async () => ({ ok: false, status: 500 }) }).then(() => false).catch(() => true));
{
  let deleteUrl = null;
  await pruneLivenessRows({ url: 'https://x.supabase.co', key: 'k', nowMs: Date.parse('2026-06-10T12:00:00Z'), fetchImpl: async (u) => { deleteUrl = u; return { ok: true }; } });
  check('writer: prune deletes charlie-liveness rows older than 24h', deleteUrl.includes('workflow_id=eq.charlie-liveness') && deleteUrl.includes('created_at=lt.2026-06-09T12'));
}
check('writer: disabled (no-op) when SUPABASE creds missing', (() => {
  let called = false; const stop = startLivenessHeartbeat({ env: {}, fetchImpl: async () => { called = true; return { ok: true }; } });
  stop(); return typeof stop === 'function' && !called;
})());

// ── watcher: classify ─────────────────────────────────────────────────────────
console.log('liveness watcher — classify:');
const nowMs = Date.parse('2026-06-10T12:00:00Z');
const beat = (agoMs, md = {}) => ({ created_at: new Date(nowMs - agoMs).toISOString(), status: 'success', metadata: { pid: 9, version: '1.3.4', channel_status: 'active', polling_ok: true, ...md } });
check('classify: read error → unknown (loud)', classify({ readError: 'Supabase HTTP 503', nowMs, staleMs: STALE }).class === 'unknown');
check('classify: no row → armed', classify({ row: null, nowMs, staleMs: STALE }).class === 'armed');
check('classify: fresh + active → healthy', classify({ row: beat(30_000), serverNowMs: nowMs, nowMs, staleMs: STALE }).class === 'healthy');
check('classify: stale → down (names host, ordered diagnostics, reminder cadence)', (() => { const d = classify({ row: beat(10 * 60_000), serverNowMs: nowMs, nowMs, staleMs: STALE }); return d.class === 'down' && /pm2 list/.test(d.message) && /journalctl -u pm2-root/.test(d.message) && /qclaw \(138\.68\.138\.214\)/.test(d.message) && /every 15m then hourly/.test(d.message); })());
check('classify: custom target threads into message', /myhost/.test(classify({ row: beat(10 * 60_000), serverNowMs: nowMs, nowMs, staleMs: STALE, target: 'myhost' }).message));
check('classify: fresh + degraded → polling (class b)', classify({ row: beat(30_000, { channel_status: 'degraded', polling_ok: false }), serverNowMs: nowMs, nowMs, staleMs: STALE }).class === 'polling');
check('classify: uses SERVER clock (Date hdr) over local — skewed local would say stale, server says fresh',
  classify({ row: beat(30_000), serverNowMs: nowMs, nowMs: nowMs + 30 * 60_000, staleMs: STALE }).class === 'healthy');

// ── watcher: episode + reminder cadence ───────────────────────────────────────
console.log('liveness watcher — cooldown/reminders:');
const t0 = Date.parse('2026-06-10T12:00:00Z');
const ev = (mins, event, cls = 'down') => ({ ts: new Date(t0 + mins * 60_000).toISOString(), class: cls, event });
check('episode: fired w/o recovered → active', !!activeEpisode([ev(0, 'fired')], 'down'));
check('episode: fired then recovered → inactive', activeEpisode([ev(0, 'fired'), ev(5, 'recovered')], 'down') === null);
check('reminder: no episode → first alert fires', reminderDue(null, t0) === true);
check('reminder: within first 15m → quiet', reminderDue({ firstFired: t0, lastFired: t0 }, t0 + 10 * 60_000) === false);
check('reminder: at 15m → reminder fires', reminderDue({ firstFired: t0, lastFired: t0 }, t0 + 15 * 60_000) === true);
check('reminder: 30m after a 15m reminder (44m gap<60) → quiet', reminderDue({ firstFired: t0, lastFired: t0 + 15 * 60_000 }, t0 + 45 * 60_000) === false);
check('reminder: hourly after first reminder', reminderDue({ firstFired: t0, lastFired: t0 + 15 * 60_000 }, t0 + 80 * 60_000) === true);

// ── watcher: runWatcher orchestration (injected fetch + temp state) ───────────
console.log('liveness watcher — runWatcher:');
function makeFetch({ beatRow, supabaseOk = true, serverDate, telegramOk = true, sends }) {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('/rest/v1/workflow_heartbeats')) {
      if (!supabaseOk) return { ok: false, status: 503, json: async () => ({}), headers: { get: () => null } };
      return { ok: true, status: 200, json: async () => (beatRow ? [beatRow] : []), headers: { get: (h) => h.toLowerCase() === 'date' ? serverDate : null } };
    }
    if (u.includes('api.telegram.org')) { sends.push(JSON.parse(opts.body)); return { ok: telegramOk, status: telegramOk ? 200 : 500 }; }
    return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } };
  };
}
const baseEnv = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', TELEGRAM_BOT_TOKEN: 'tok', LIVENESS_STALE_MINUTES: '4' };
const serverDate = new Date(nowMs).toUTCString();
let n = 0;
const freshPath = () => join(dir, `state-${++n}.log`);

// HIGH#1: Supabase read failure → fires UNKNOWN, never silent
{
  const sends = []; const sp = freshPath();
  const r = await runWatcher({ env: baseEnv, nowMs, statePath: sp, fetchImpl: makeFetch({ supabaseOk: false, serverDate, sends }) });
  check('runWatcher: read failure → fires UNKNOWN (loud, not silent)', r.class === 'unknown' && r.fired === true && sends.some(s => /UNKNOWN/.test(s.text)));
}
// down: stale beat, empty state → fires
{
  const sends = []; const sp = freshPath();
  const r = await runWatcher({ env: baseEnv, nowMs, statePath: sp, fetchImpl: makeFetch({ beatRow: beat(10 * 60_000), serverDate, sends }) });
  check('runWatcher: stale beat → fires DOWN with diagnostic pointer', r.class === 'down' && r.fired && sends.some(s => /pm2 list/.test(s.text)));
}
// healthy → no alert
{
  const sends = []; const sp = freshPath();
  const r = await runWatcher({ env: baseEnv, nowMs, statePath: sp, fetchImpl: makeFetch({ beatRow: beat(30_000), serverDate, sends }) });
  check('runWatcher: fresh beat → healthy, no alert', r.class === 'healthy' && !r.fired && sends.length === 0);
}
// cooldown: second down within 15m → suppressed
{
  const sends = []; const sp = freshPath();
  await runWatcher({ env: baseEnv, nowMs, statePath: sp, fetchImpl: makeFetch({ beatRow: beat(10 * 60_000), serverDate, sends }) });
  const r2 = await runWatcher({ env: baseEnv, nowMs: nowMs + 60_000, statePath: sp, fetchImpl: makeFetch({ beatRow: beat(11 * 60_000), serverDate, sends }) });
  check('runWatcher: repeat DOWN within 15m → suppressed (no storm)', r2.fired === false && r2.suppressed === 'cooldown' && sends.length === 1);
}
// recovery: down then healthy → all-clear
{
  const sends = []; const sp = freshPath();
  await runWatcher({ env: baseEnv, nowMs, statePath: sp, fetchImpl: makeFetch({ beatRow: beat(10 * 60_000), serverDate, sends }) });
  const r2 = await runWatcher({ env: baseEnv, nowMs: nowMs + 60_000, statePath: sp, fetchImpl: makeFetch({ beatRow: beat(20_000), serverDate: new Date(nowMs + 60_000).toUTCString(), sends }) });
  check('runWatcher: recovery → all-clear sent (with downtime duration)', r2.class === 'healthy' && sends.some(s => /recovered/.test(s.text) && /Was down for ~\d+m/.test(s.text)));
}
// cold start: no rows, no state → armed one-shot, not repeated
{
  const sends = []; const sp = freshPath();
  const r1 = await runWatcher({ env: baseEnv, nowMs, statePath: sp, fetchImpl: makeFetch({ beatRow: null, serverDate, sends }) });
  const r2 = await runWatcher({ env: baseEnv, nowMs: nowMs + 60_000, statePath: sp, fetchImpl: makeFetch({ beatRow: null, serverDate, sends }) });
  check('runWatcher: cold start → armed once, NOT a false outage', r1.class === 'armed' && r2.class === 'armed' && sends.filter(s => /armed/.test(s.text)).length === 1);
}
// HIGH#3: inverted polarity — unreadable ledger + stale → STILL fires
{
  const sends = []; const badStatePath = dir; // a directory → readFileSync throws → readable:false
  const r = await runWatcher({ env: baseEnv, nowMs, statePath: badStatePath, fetchImpl: makeFetch({ beatRow: beat(10 * 60_000), serverDate, sends }) });
  check('runWatcher: unreadable ledger + DOWN → STILL fires (inverted polarity)', r.class === 'down' && r.fired === true && sends.some(s => /LIVENESS/.test(s.text)));
}

// regression: cooldown ledger must persist via env.LIVENESS_DIR when statePath
// is omitted (the live bug: it read process.env.LIVENESS_DIR → unwritable /root
// → no persistence → DOWN re-fired every run = storm).
{
  const sends = []; const ldir = join(dir, 'lvdir'); mkdirSync(ldir, { recursive: true });
  const envD = { ...baseEnv, LIVENESS_DIR: ldir };
  const f = () => makeFetch({ beatRow: beat(10 * 60_000), serverDate, sends });
  const r1 = await runWatcher({ env: envD, nowMs, fetchImpl: f() });                       // no statePath
  const r2 = await runWatcher({ env: envD, nowMs: nowMs + 60_000, fetchImpl: f() });
  check('runWatcher: cooldown persists via env.LIVENESS_DIR (no storm)', r1.fired === true && r2.fired === false && r2.suppressed === 'cooldown' && sends.length === 1);
}

check('parseEnvFile: parses KEY=val, strips quotes, skips comments', (() => {
  const e = parseEnvFile('# c\nA=1\nB="two"\n\nC=\n'); return e.A === '1' && e.B === 'two' && e.C === '';
})());

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
