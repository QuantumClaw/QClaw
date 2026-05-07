/**
 * Bootstrap mechanism tests.
 *
 * Run: node tests/bootstrap.test.js
 *
 * Covers cache TTL + cache-key shape, /session-style eviction, layer
 * fail-soft behaviour, warning surfacing, and the markdown formatter.
 * Probes are NOT exercised here — see tests/probes.test.js.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  bootstrap,
  clearCache,
  clearAllCaches,
  isCached,
  cacheSize,
  formatStatusMarkdown
} from '../src/agents/bootstrap.js';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// Build a stub services bag so the layers don't blow up in CI sandboxes.
function stubServices({ trustKernelRaw = 'STUB_VALUES', auditDb = true } = {}) {
  return {
    trustKernel: { raw: trustKernelRaw },
    audit: {
      db: auditDb,
      recent(limit = 50) {
        return Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
          id: i, agent: 'stub', action: 'completion', timestamp: new Date().toISOString()
        }));
      }
    },
    memory: {
      cogneeConnected: false,
      db: true,
      cogneeUrl: 'http://localhost:8000',
      recentEntries({ since: _s, limit = 30 } = {}) {
        return Array.from({ length: Math.min(limit, 4) }, (_, i) => ({
          agent: 'stub', role: i % 2 ? 'assistant' : 'user', content: `entry ${i}`,
          timestamp: new Date().toISOString()
        }));
      }
    }
  };
}

async function main() {
  // Use an isolated config dir so we don't write to ~/.quantumclaw during tests.
  const tmp = mkdtempSync(join(tmpdir(), 'qclaw-bootstrap-test-'));
  const config = { _dir: tmp };
  // Workspace tree with a charlie SOUL so Layer 1 has something to read.
  mkdirSync(join(tmp, 'workspace', 'agents', 'charlie'), { recursive: true });
  writeFileSync(join(tmp, 'workspace', 'agents', 'charlie', 'SOUL.md'), '# Test SOUL\nstub');
  writeFileSync(join(tmp, 'workspace', 'agents', 'charlie', 'IDENTITY.md'), '# Test IDENTITY\nstub');

  // bootstrap.log path is derived from config._dir, so passing _dir above
  // already isolates the log to the tmpdir — no need to mutate process.env.HOME.

  clearAllCaches();

  // ─── 1. Cache miss returns a populated result.
  const r1 = await bootstrap({
    userId: 9999, agentName: 'charlie',
    services: stubServices(), config
  });
  check('cache miss: result has agent_name', r1.agent_name === 'charlie');
  check('cache miss: result has cache_key', r1.cache_key === '9999:charlie');
  check('cache miss: identity.soul populated', typeof r1.identity.soul === 'string' && r1.identity.soul.includes('Test SOUL'));
  check('cache miss: identity.values from trustKernel', r1.identity.values === 'STUB_VALUES');
  check('cache miss: identity.identity_doc populated', typeof r1.identity.identity_doc === 'string');
  check('cache miss: probes is array of 5', Array.isArray(r1.probes) && r1.probes.length === 5,
    `got ${r1.probes?.length}`);
  check('cache miss: cacheSize is 1', cacheSize() === 1);
  check('cache miss: isCached(9999, charlie)', isCached(9999, 'charlie'));
  check('cache miss: isCached(9999, other) is false', !isCached(9999, 'other-agent'));

  // ─── 2. Cache hit returns identical loaded_at.
  const r2 = await bootstrap({
    userId: 9999, agentName: 'charlie',
    services: stubServices(), config
  });
  check('cache hit: loaded_at unchanged', r2.loaded_at === r1.loaded_at);

  // ─── 3. force-reload bypasses cache.
  // Sleep 5ms so loaded_at differs; ISO precision is millisecond.
  await new Promise(r => setTimeout(r, 5));
  const r3 = await bootstrap({
    userId: 9999, agentName: 'charlie',
    services: stubServices(), config,
    options: { force: true }
  });
  check('force reload: loaded_at changes', r3.loaded_at !== r1.loaded_at,
    `r1=${r1.loaded_at} r3=${r3.loaded_at}`);
  check('force reload: cacheSize still 1', cacheSize() === 1);

  // ─── 4. Cache key partitions per (userId, agentName).
  await bootstrap({ userId: 9999, agentName: 'echo', services: stubServices(), config });
  check('cache partitions per agent: cacheSize 2', cacheSize() === 2);
  await bootstrap({ userId: 8888, agentName: 'charlie', services: stubServices(), config });
  check('cache partitions per user: cacheSize 3', cacheSize() === 3);

  // ─── 5. clearCache(userId) evicts all entries for that user.
  const removed = clearCache(9999);
  check('clearCache(userId) removed entries', removed === true);
  check('clearCache(userId): cacheSize 1', cacheSize() === 1, `got ${cacheSize()}`);
  check('clearCache(userId): 8888:charlie still cached', isCached(8888, 'charlie'));
  check('clearCache(userId): 9999:charlie evicted', !isCached(9999, 'charlie'));

  // ─── 6. clearCache(userId, agentName) evicts only that pair.
  await bootstrap({ userId: 9999, agentName: 'charlie', services: stubServices(), config });
  await bootstrap({ userId: 9999, agentName: 'echo', services: stubServices(), config });
  clearCache(9999, 'charlie');
  check('clearCache(user, agent): pair-specific eviction', !isCached(9999, 'charlie') && isCached(9999, 'echo'));

  clearAllCaches();
  check('clearAllCaches: cacheSize 0', cacheSize() === 0);

  // ─── 7. Layer fail-soft: missing SOUL.md adds a warning, other layers intact.
  const cfgMissing = { _dir: mkdtempSync(join(tmpdir(), 'qclaw-fail-soft-')) };
  // No workspace tree → SOUL missing.
  const r4 = await bootstrap({
    userId: 7777, agentName: 'charlie',
    services: stubServices(), config: cfgMissing
  });
  check('fail-soft: result still returned', r4 && r4.agent_name === 'charlie');
  check('fail-soft: SOUL warning present',
    r4.warnings.some(w => w.includes('SOUL.md missing')));
  check('fail-soft: probes still attempted', Array.isArray(r4.probes) && r4.probes.length === 5);
  check('fail-soft: identity.values still populated from trustKernel',
    r4.identity.values === 'STUB_VALUES');
  rmSync(cfgMissing._dir, { recursive: true, force: true });

  // ─── 8. formatStatusMarkdown produces expected sections.
  const md = formatStatusMarkdown(r1);
  check('formatStatusMarkdown: has title', md.startsWith('# Bootstrap status'));
  check('formatStatusMarkdown: 5 layer headers',
    /## Layer 1 — Identity/.test(md) &&
    /## Layer 2 — State/.test(md) &&
    /## Layer 3 — Specialists/.test(md) &&
    /## Layer 4 — Recent context/.test(md) &&
    /## Layer 5 — Live probes/.test(md));
  check('formatStatusMarkdown: probe lines have ✓ or ✗',
    /[✓✗] (n8n_reachable|heartbeat_freshness|pm2_processes|supabase_reachable|memory_layer)/.test(md));

  // ─── 9. Layer 5 wall-clock budget under timeout cap.
  const t0 = Date.now();
  await bootstrap({
    userId: 6666, agentName: 'charlie',
    services: stubServices(), config,
    options: { force: true }
  });
  const wall = Date.now() - t0;
  check('Layer 5: total wall-clock ≤ 6s', wall <= 6000, `got ${wall}ms`);

  // ─── 10. Cleanup
  rmSync(tmp, { recursive: true, force: true });
  clearAllCaches();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
