/**
 * Slice 3d — spawn-module cap/timeout enforcement tests (round-1 code
 * review M1 remediation).
 *
 * Design SSOT /tmp/slice3d_design.md Appendix B specified two
 * spawn-module guarantees that Unit 1's test plan named but didn't
 * cover:
 *
 *   1) Output cap — when the spawned process emits more than
 *      MAX_OUTPUT_BYTES on stdout+stderr combined, the hand-rolled
 *      accumulator must SIGKILL the child and return
 *      { ok:false, error:'output_cap_exceeded', exit_code:-1 }.
 *
 *   2) Timeout — when the spawned process exceeds SPAWN_TIMEOUT_MS,
 *      Node's spawn timeout option fires SIGKILL and the exit handler
 *      must return { ok:false, error:'timeout', exit_code:-1 } (the
 *      `signal === 'SIGKILL' && child.killed` branch in
 *      shell-exec-spawn.js).
 *
 * Both code paths regress silently under refactor without coverage;
 * the reviewer's wording: "the hand-rolled accumulator + kill-on-cap
 * code path could regress under refactor and no test would notice."
 *
 * ----- Why a spy that delegates to the real spawn -----
 *
 * Hardcoded in shell-exec-verb-schemas.js:
 *   - ALLOWED_CWD = '/root/QClaw'       (prod path; does not exist on
 *                                        dev/CI boxes)
 *   - SPAWN_TIMEOUT_MS = 30_000         (30 s — too slow for a test)
 *
 * These are correct production values that we MUST NOT widen for
 * tests. Instead we spy on child_process.spawn via node:test
 * mock.method (same pattern as shell-exec-env-isolation.test.js),
 * mutate options.cwd → process.cwd() and options.timeout → short for
 * the timeout test, then delegate to the real spawn. The
 * accumulator / kill / exit-handler code paths under test still
 * execute end-to-end against a real child process.
 *
 * ----- mkfifo fallback -----
 *
 * The timeout test uses a real named pipe so cat blocks on read.
 * mkfifo is BSD/POSIX standard; if a future CI host doesn't ship it
 * (or fifos misbehave on a future macOS) we skip with a warning
 * rather than fail.
 */

import { mock } from 'node:test';
import child_process from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { spawnWithCaps } from '../src/tools/shell-exec-spawn.js';
import { MAX_OUTPUT_BYTES } from '../src/tools/shell-exec-verb-schemas.js';

let passed = 0;
let failed = 0;
let skipped = 0;
function check(name, cond, detail = null) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.log(`  ✗ ${name}`);
    if (detail !== null) console.log(`      ${String(JSON.stringify(detail)).slice(0, 400)}`);
  }
}
function skip(name, reason) {
  skipped++;
  console.log(`  ⊘ ${name} — skipped: ${reason}`);
}

const REPO_ROOT = process.cwd();
const realSpawn = child_process.spawn.bind(child_process);

/**
 * Install a spy that rewrites the spawn options before delegating to
 * the real child_process.spawn. We only override cwd (and timeout if
 * the test needs it) — everything else (shell:false, SAFE_ENV, stdio,
 * killSignal, windowsHide, argv) flows through unchanged so we exercise
 * the real code paths.
 */
function installRealDelegatingSpy({ cwdOverride, timeoutOverride } = {}) {
  return mock.method(child_process, 'spawn', (bin, args, opts) => {
    const newOpts = { ...opts };
    if (cwdOverride !== undefined) newOpts.cwd = cwdOverride;
    if (timeoutOverride !== undefined) newOpts.timeout = timeoutOverride;
    return realSpawn(bin, args, newOpts);
  });
}

// ----------------------------------------------------------------------
// Test A — output-cap enforcement
// ----------------------------------------------------------------------

async function runOutputCapTest() {
  console.log('\n=== A. Output-cap kills child and returns output_cap_exceeded ===');

  // Create a >1 MiB fixture in a temp path (cleaned up after).
  const fixturePath = path.join(REPO_ROOT, `.tmp_test_large_${process.pid}.bin`);
  const sizeBytes = MAX_OUTPUT_BYTES + 64 * 1024; // 1 MiB + 64 KiB
  const chunkSize = 64 * 1024;
  const fh = fs.openSync(fixturePath, 'w');
  try {
    const chunk = Buffer.alloc(chunkSize, 0x41); // 'A'
    let written = 0;
    while (written < sizeBytes) {
      const toWrite = Math.min(chunkSize, sizeBytes - written);
      fs.writeSync(fh, chunk, 0, toWrite);
      written += toWrite;
    }
  } finally {
    fs.closeSync(fh);
  }
  check('fixture is >MAX_OUTPUT_BYTES', fs.statSync(fixturePath).size > MAX_OUTPUT_BYTES, {
    size: fs.statSync(fixturePath).size,
    cap: MAX_OUTPUT_BYTES,
  });

  const spy = installRealDelegatingSpy({ cwdOverride: REPO_ROOT });
  try {
    // Synthesise a validated parse result — bypasses parser/schema (those
    // are covered by their own tests). The spawn module accepts any
    // argv whose argv[0] is a known verb in VERB_BINARY.
    const validated = {
      ok: true,
      argv: ['cat', fixturePath],
      schemaKey: 'cat',
      verbTokens: 1,
      resolvedPaths: new Map([[1, fixturePath]]),
    };

    const t0 = Date.now();
    const res = await spawnWithCaps(validated);
    const elapsed = Date.now() - t0;

    check('error === output_cap_exceeded', res.error === 'output_cap_exceeded', res);
    check('ok === false', res.ok === false, res);
    check('exit_code === -1', res.exit_code === -1, res);
    check('reason mentions byte cap', typeof res.reason === 'string' && /bytes/.test(res.reason), res);
    check('returned well under 30s spawn timeout (no hang)', elapsed < 10_000, { elapsed_ms: elapsed });
    check('partial_stdout is truncated (≤4000 chars)', typeof res.partial_stdout === 'string' && res.partial_stdout.length <= 4000, {
      partial_len: res.partial_stdout ? res.partial_stdout.length : null,
    });
  } finally {
    spy.mock.restore();
    try { fs.unlinkSync(fixturePath); } catch { /* ignore */ }
  }
}

// ----------------------------------------------------------------------
// Test B — timeout enforcement
// ----------------------------------------------------------------------

async function runTimeoutTest() {
  console.log('\n=== B. Timeout fires SIGKILL and returns error=timeout ===');

  // mkfifo is BSD/POSIX standard but we skip-with-warning if unavailable
  // (per L8 pattern). A 0-byte fifo with no writer blocks cat's read()
  // forever — exactly what the spawn timeout must kill.
  const fifoPath = path.join('/tmp', `qclaw_test_fifo_${process.pid}`);
  try {
    child_process.execFileSync('mkfifo', [fifoPath]);
  } catch (e) {
    skip('timeout test', `mkfifo unavailable: ${e && e.code ? e.code : String(e)}`);
    return;
  }

  // Override the spawn timeout to 1500ms for the test — exercising the
  // real `signal === 'SIGKILL' && child.killed` branch in the exit
  // handler without making CI wait 30 s.
  const SHORT_TIMEOUT_MS = 1500;
  const spy = installRealDelegatingSpy({
    cwdOverride: REPO_ROOT,
    timeoutOverride: SHORT_TIMEOUT_MS,
  });

  try {
    const validated = {
      ok: true,
      argv: ['cat', fifoPath],
      schemaKey: 'cat',
      verbTokens: 1,
      resolvedPaths: new Map([[1, fifoPath]]),
    };

    const t0 = Date.now();
    const res = await spawnWithCaps(validated);
    const elapsed = Date.now() - t0;

    check('error === timeout', res.error === 'timeout', res);
    check('ok === false', res.ok === false, res);
    check('exit_code === -1', res.exit_code === -1, res);
    check('reason mentions ms cap', typeof res.reason === 'string' && /ms/.test(res.reason), res);
    check(
      `elapsed in [${SHORT_TIMEOUT_MS}, ${SHORT_TIMEOUT_MS + 5000}] ms (timeout fired, no hang)`,
      elapsed >= SHORT_TIMEOUT_MS - 100 && elapsed < SHORT_TIMEOUT_MS + 5000,
      { elapsed_ms: elapsed },
    );
  } finally {
    spy.mock.restore();
    try { fs.unlinkSync(fifoPath); } catch { /* ignore */ }
  }
}

(async function main() {
  try {
    await runOutputCapTest();
    await runTimeoutTest();
    console.log(`\n=== shell-exec-spawn-limits.test.js: ${passed} passed, ${failed} failed, ${skipped} skipped ===\n`);
    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Unhandled error:', err);
    process.exit(2);
  }
})();
