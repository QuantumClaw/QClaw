/**
 * Probe contract + timeout tests.
 *
 * Run: node tests/probes.test.js
 *
 * Each probe is exercised against the live infrastructure that QClaw
 * already depends on (n8n /healthz, Supabase /auth/v1/health, Cognee
 * /health, pm2 jlist, the Supabase SUPABASE_ANON_KEY). When upstream is
 * unavailable, the probe MUST surface ok=false with an error message
 * — never throw — so the bootstrap caller can keep going.
 *
 * Tests assert the result-shape contract is honoured (name, ok flag,
 * latency_ms, optional error / detail) regardless of pass/fail outcome.
 */

import { probe as probeN8n } from '../src/agents/probes/n8n.js';
import { probe as probeHeartbeat } from '../src/agents/probes/heartbeat-freshness.js';
import { probe as probePm2, parsePm2Output } from '../src/agents/probes/pm2.js';
import { probe as probeSupabase } from '../src/agents/probes/supabase.js';
import { probe as probeMemory } from '../src/agents/probes/memory-layer.js';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

function assertShape(name, r) {
  check(`${name}: result.name correct`, r?.name === name);
  check(`${name}: ok is boolean`, typeof r?.ok === 'boolean');
  check(`${name}: latency_ms is finite number`,
    Number.isFinite(r?.latency_ms) && r.latency_ms >= 0);
  // Failure must carry an error string.
  if (r && r.ok === false) {
    check(`${name}: failure carries error string`, typeof r.error === 'string' && r.error.length > 0);
  }
  // Latency under 6s as a sanity check (per-probe Promise.race in bootstrap.js
  // caps at 5s; probes themselves should self-terminate inside that.)
  check(`${name}: latency_ms < 6000`, r?.latency_ms < 6000, `got ${r?.latency_ms}`);
}

async function main() {
  // ─── n8n
  const r1 = await probeN8n();
  assertShape('n8n_reachable', r1);

  // ─── heartbeat freshness (may be ok or fail-with-RLS-message; both valid)
  const r2 = await probeHeartbeat();
  assertShape('heartbeat_freshness', r2);

  // ─── pm2
  const r3 = await probePm2();
  assertShape('pm2_processes', r3);
  if (r3.ok) {
    check('pm2: detail.expected has 5 entries',
      Array.isArray(r3.detail?.expected) && r3.detail.expected.length === 5);
  }

  // ─── pm2 parse helper: tolerates leading non-JSON lines (regression for
  //     2026-05-06T12:10:19Z ghost fire — pm2 jlist occasionally prepends
  //     a Node deprecation warning before the JSON array).
  const withWarningHeader =
    '(node:12345) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. ' +
    'Please use a userland alternative instead.\n' +
    '(Use `node --trace-deprecation ...` to show where the warning was created)\n' +
    '[{"pid":2498133,"name":"agex-hub","pm2_env":{"status":"online"}}]';
  let parsedWithHeader;
  try { parsedWithHeader = parsePm2Output(withWarningHeader); } catch (e) { parsedWithHeader = e; }
  check('pm2 parse: deprecation-warning header is stripped',
    Array.isArray(parsedWithHeader) && parsedWithHeader[0]?.name === 'agex-hub');

  // ─── pm2 parse helper: empty / no-JSON-line input falls back to []
  let parsedEmpty;
  try { parsedEmpty = parsePm2Output(''); } catch (e) { parsedEmpty = e; }
  check('pm2 parse: empty input → []', Array.isArray(parsedEmpty) && parsedEmpty.length === 0);

  // ─── pm2 parse helper: clean JSON still parses
  let parsedClean;
  try { parsedClean = parsePm2Output('[{"name":"x","pm2_env":{"status":"online"}}]'); } catch (e) { parsedClean = e; }
  check('pm2 parse: clean JSON parses', Array.isArray(parsedClean) && parsedClean[0]?.name === 'x');

  // ─── supabase
  const r4 = await probeSupabase();
  assertShape('supabase_reachable', r4);

  // ─── memory layer
  const r5 = await probeMemory({ cogneeUrl: 'http://localhost:8000' });
  assertShape('memory_layer', r5);

  // ─── A clearly-broken target must still produce an ok=false result, never throw.
  const broken = await probeMemory({ cogneeUrl: 'http://127.0.0.1:1' });
  check('memory_layer: broken target → ok=false', broken.ok === false);
  check('memory_layer: broken target → error present', typeof broken.error === 'string' && broken.error.length > 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
