/**
 * Slice 3h — Charlie liveness WATCHER (runs OFF-HOST: n8n droplet cron).
 *
 * The monitor. Reads the latest `charlie-liveness` heartbeat from Supabase and
 * alerts via the Telegram HTTP API directly (NOT Charlie's bot loop) when Charlie
 * is down/hung/host-down (staleness) or up-but-polling-degraded (class b). It runs
 * on a DIFFERENT machine from quantumclaw so it survives a qclaw host failure
 * (class d) — the hard constraint: a monitor must not depend on the thing it monitors.
 *
 * SELF-CONTAINED on purpose: the n8n droplet has no QClaw repo, so this file uses
 * only Node built-ins + global fetch (Node 18+). It reads its own .env. Lives in
 * the repo for review + tests; deployed standalone to /root/charlie-liveness/.
 *
 * Adversarial-review hardening (see /tmp/slice3h_design.md "Reconciliation"):
 *  - HIGH#1: a Supabase READ FAILURE is alerted LOUD as class `unknown` — never a
 *    silent exit-0. (A Supabase outage blinds writer AND watcher and is itself a
 *    real Charlie outage.)
 *  - HIGH#3: INVERTED ledger polarity vs spend-alerter — if the cooldown ledger is
 *    unreadable/unwritable, outage classes STILL fire (accept a storm; a dead
 *    Charlie must be loud). Suppression only ever gates reminder cadence, never the
 *    first outage alert.
 *  - MED#5: staleness computed against Supabase's clock (response `Date` header),
 *    not the droplet clock — avoids droplet clock-skew false/missed alerts.
 *  - MED#6: zero rows EVER → one-shot "armed", not a false outage.
 *
 * Always exits 0 (cron hygiene) — but a read failure becomes an alert, not silence.
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOW_ID = 'charlie-liveness';
const OWNER_TELEGRAM_CHAT_ID = 1375806243;
const MODE = 0o600;
const DEFAULT_STALE_MINUTES = 4;
const FIRST_REMINDER_MS = 15 * 60_000;
const THEN_EVERY_MS = 60 * 60_000;
const DEGRADED_STATES = new Set(['degraded', 'retrying', 'stopped', 'manual_intervention_required']);
const DEFAULT_TARGET = 'qclaw (138.68.138.214)';
const REMINDER_CADENCE = 'Reminding every 15m then hourly until it clears.';
const hhmmZ = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(11, 16) + 'Z'; };

// ── env (self-contained loader) ────────────────────────────────────────────
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}
function loadEnv() {
  const path = process.env.LIVENESS_ENV_PATH || '/root/charlie-liveness/.env';
  let fileEnv = {};
  try { if (existsSync(path)) fileEnv = parseEnvFile(readFileSync(path, 'utf-8')); } catch { /* */ }
  return { ...fileEnv, ...process.env };
}

// ── Supabase read (returns server clock from the Date header) ───────────────
export async function fetchLatestBeat({ url, key, fetchImpl = fetch }) {
  const base = (url || '').replace(/\/+$/, '');
  const q = `${base}/rest/v1/workflow_heartbeats?workflow_id=eq.${WORKFLOW_ID}` +
    `&select=created_at,status,metadata&order=created_at.desc&limit=1`;
  const res = await fetchImpl(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
  const arr = await res.json();
  const dateHdr = res.headers?.get ? res.headers.get('date') : null;
  const serverNowMs = dateHdr ? Date.parse(dateHdr) : NaN;
  return { row: Array.isArray(arr) && arr.length ? arr[0] : null, serverNowMs };
}

// ── classification ──────────────────────────────────────────────────────────
/** @returns {class:'down'|'unknown'|'polling'|'healthy'|'armed', ...} */
export function classify({ readError, row, serverNowMs, nowMs = Date.now(), staleMs, target = DEFAULT_TARGET }) {
  if (readError) {
    return { class: 'unknown', message:
      `🟠 Charlie LIVENESS UNKNOWN — watcher cannot reach Supabase (${readError}).\n` +
      `Liveness of ${target} is indeterminate, and a Supabase outage is itself a Charlie outage.\n` +
      `Check Supabase status and n8n-droplet connectivity. ${REMINDER_CADENCE}` };
  }
  if (!row) return { class: 'armed' }; // zero rows ever → cold start (handled by caller)

  const ts = Date.parse(row.created_at);
  const ref = Number.isFinite(serverNowMs) ? serverNowMs : nowMs; // MED#5: prefer server clock
  const ageMs = ref - ts;
  const ageMin = Math.max(0, Math.round(ageMs / 60_000));
  const md = row.metadata || {};

  if (ageMs > staleMs) {
    return { class: 'down', ageMin, message:
      `🔴 Charlie LIVENESS — no heartbeat for ${ageMin}m on ${target}.\n` +
      `quantumclaw is DOWN, hung, or the host is unreachable.\n` +
      `Check (in order): \`pm2 list\` → \`journalctl -u pm2-root --since '20 min ago'\` → \`pm2 logs quantumclaw\`\n` +
      `Last beat ${hhmmZ(row.created_at)} (pid ${md.pid ?? '?'}, v${md.version ?? '?'}). ${REMINDER_CADENCE}` };
  }
  const cs = md.channel_status;
  if (md.polling_ok === false || DEGRADED_STATES.has(cs)) {
    return { class: 'polling', ageMin, channel_status: cs, message:
      `🟡 Charlie UP but Telegram polling DEGRADED on ${target} (3e state: ${cs}).\n` +
      `Process alive (beat ${Math.round(ageMs / 1000)}s ago) but not serving Telegram.\n` +
      `Check: \`~/.quantumclaw/channel-events.log\` · \`pm2 logs quantumclaw\`. ${REMINDER_CADENCE}` };
  }
  return { class: 'healthy', ageMin, channel_status: cs };
}

// ── cooldown / reminder ledger (JSONL) ───────────────────────────────────────
export function readState(path) {
  if (!existsSync(path)) return { entries: [], readable: true };
  try {
    const lines = readFileSync(path, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    const entries = [];
    for (const l of lines) { try { const e = JSON.parse(l); if (e && e.event) entries.push(e); } catch { /* skip */ } }
    return { entries, readable: true };
  } catch { return { entries: [], readable: false }; }
}
/** Active episode for an outage class: the latest 'fired' with no later 'recovered'. */
export function activeEpisode(entries, cls) {
  let firstFired = null, lastFired = null;
  for (const e of entries) {
    if (e.class !== cls) continue;
    const t = Date.parse(e.ts);
    if (!Number.isFinite(t)) continue;
    if (e.event === 'recovered') { firstFired = null; lastFired = null; }
    else if (e.event === 'fired') { if (firstFired == null) firstFired = t; lastFired = t; }
  }
  return firstFired == null ? null : { firstFired, lastFired };
}
export function reminderDue(ep, nowMs) {
  if (!ep) return true; // not active → this is the FIRST alert
  const elapsed = nowMs - ep.firstFired;
  const sinceLast = nowMs - ep.lastFired;
  if (elapsed < FIRST_REMINDER_MS) return false;            // quiet for the first 15m
  if (ep.lastFired === ep.firstFired) return sinceLast >= FIRST_REMINDER_MS; // the 15m reminder
  return sinceLast >= THEN_EVERY_MS;                        // hourly thereafter
}
function appendState(path, entry) {
  try { appendFileSync(path, JSON.stringify(entry) + '\n', { mode: MODE }); chmodSync(path, MODE); return true; }
  catch { return false; }
}

// ── Telegram (direct API, never Charlie's bot) ──────────────────────────────
export async function sendTelegram({ token, chatId, text, fetchImpl = fetch }) {
  if (!token) return { ok: false, reason: 'no token' };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return { ok: !!res.ok };
  } catch { return { ok: false, reason: 'fetch threw' }; }
}

// ── orchestrator ─────────────────────────────────────────────────────────────
export async function runWatcher({ env, nowMs = Date.now(), fetchImpl = fetch, statePath } = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY; // service_role required for RLS read
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = Number(env.LIVENESS_ALERT_CHAT_ID) || OWNER_TELEGRAM_CHAT_ID;
  const staleMs = (Number(env.LIVENESS_STALE_MINUTES) || DEFAULT_STALE_MINUTES) * 60_000;
  // LIVENESS_DIR comes from the .env FILE (merged into `env`), so read it from
  // `env` first — reading process.env here defaulted to an unwritable /root path
  // on the n8n droplet, which silently broke cooldown persistence → alert storm.
  const sp = statePath || join(env.LIVENESS_DIR || process.env.LIVENESS_DIR || '/root/charlie-liveness', 'liveness-state.log');
  const target = env.LIVENESS_TARGET || DEFAULT_TARGET;
  const OUTAGE = new Set(['down', 'unknown', 'polling']);

  // Read (loud on failure — HIGH#1).
  let decision;
  try {
    const { row, serverNowMs } = await fetchLatestBeat({ url, key, fetchImpl });
    decision = classify({ row, serverNowMs, nowMs, staleMs, target });
  } catch (err) {
    decision = classify({ readError: err.message || String(err), nowMs, staleMs, target });
  }

  const { entries, readable } = readState(sp);
  const ledgerHealthy = readable; // unreadable ⇒ treat as no history (inverted polarity below)

  // Recovery: any previously-active outage class that is now NOT the current class → all-clear.
  const currentlyActive = new Set(
    ['down', 'unknown', 'polling'].filter(c => activeEpisode(entries, c)));
  const nowOutage = OUTAGE.has(decision.class);
  for (const cls of currentlyActive) {
    if (decision.class === cls) continue; // still in this outage — handled below
    const ep = activeEpisode(entries, cls);
    const downMin = ep ? Math.max(1, Math.round((nowMs - ep.firstFired) / 60_000)) : null;
    const text = `🟢 Charlie LIVENESS recovered on ${target} — ${decision.class === 'healthy'
      ? `heartbeat fresh (~${decision.ageMin ?? 0}m), polling ${decision.channel_status ?? 'ok'}`
      : `now ${decision.class}`}. Was ${cls}${downMin != null ? ` for ~${downMin}m` : ''}.`;
    const sent = await sendTelegram({ token, chatId, text, fetchImpl });
    if (sent.ok) appendState(sp, { ts: new Date(nowMs).toISOString(), class: cls, event: 'recovered' });
  }

  if (decision.class === 'armed') {
    // MED#6: only one-shot, and only if we've never recorded a beat before.
    const everArmed = entries.some(e => e.event === 'armed');
    if (!everArmed) {
      await sendTelegram({ token, chatId, text: '🩺 Charlie liveness monitor armed — awaiting first heartbeat from quantumclaw.', fetchImpl });
      appendState(sp, { ts: new Date(nowMs).toISOString(), class: 'armed', event: 'armed' });
    }
    return { class: 'armed', fired: false };
  }

  if (decision.class === 'healthy') return { class: 'healthy', fired: false };

  // Outage (down / unknown / polling). INVERTED polarity (HIGH#3): if the ledger
  // is unreadable we have no episode history → reminderDue(null) = fire. We do NOT
  // suppress on unwritable state; a dead Charlie must be loud even if we can't track.
  const ep = ledgerHealthy ? activeEpisode(entries, decision.class) : null;
  if (!reminderDue(ep, nowMs)) {
    return { class: decision.class, fired: false, suppressed: 'cooldown' };
  }
  const sent = await sendTelegram({ token, chatId, text: decision.message, fetchImpl });
  appendState(sp, { ts: new Date(nowMs).toISOString(), class: decision.class, event: 'fired', sent: !!sent.ok });
  return { class: decision.class, fired: true, sent: sent.ok, message: decision.message };
}

// ── cron entrypoint ──────────────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runWatcher({ env: loadEnv() })
    .then(r => { console.log(`[liveness-watcher] class=${r.class} fired=${r.fired}${r.suppressed ? ' (' + r.suppressed + ')' : ''}`); process.exit(0); })
    .catch(err => { console.error(`[liveness-watcher] error (non-fatal): ${err?.message || err}`); process.exit(0); });
}
