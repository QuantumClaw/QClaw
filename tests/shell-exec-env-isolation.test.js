/**
 * Slice 3d — env isolation spy-on-spawn test (round-3 LOW L8 redesign)
 *
 * v3's design set process.env.HOME and asserted no leak — but SAFE_ENV
 * hardcodes HOME='/root', so the test was a no-op. v4 spies on
 * child_process.spawn via node:test mock.method, captures options.env
 * at call time, and asserts on the exact env shape. The spy returns a
 * stub child that emits exit 0 immediately so spawnWithCaps resolves.
 *
 * Drives spawnWithCaps directly (not through the full shell-exec.fn —
 * Unit 1 doesn't wire that yet; Unit 2 does). spawnWithCaps is the
 * spawn boundary; asserting its env shape is the structural property
 * we care about. The full-tool integration is exercised by the harness
 * scripts/verify-shell-exec-parser.js in Unit 3.
 *
 * Uses the imperative test style consistent with the rest of the
 * QClaw test suite (no node:test harness — directly runnable via
 * `node tests/shell-exec-env-isolation.test.js`).
 */

import { mock } from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import child_process from 'node:child_process';
import { SAFE_ENV, ALLOWED_CWD, SPAWN_TIMEOUT_MS } from '../src/tools/shell-exec-verb-schemas.js';
import { spawnWithCaps } from '../src/tools/shell-exec-spawn.js';
import { parseAndValidate } from '../src/tools/shell-exec-parser.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail = null) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.log(`  ✗ ${name}`);
    if (detail !== null) console.log(`      ${String(detail).slice(0, 400)}`);
  }
}

function makeStubChild() {
  const child = new EventEmitter();
  child.stdout = Readable.from([]);
  child.stderr = Readable.from([]);
  child.kill = () => {};
  child.killed = false;
  child.pid = 12345;
  process.nextTick(() => child.emit('exit', 0, null));
  return child;
}

function setupSpy(captureRef) {
  return mock.method(child_process, 'spawn', (...args) => {
    captureRef.bin = args[0];
    captureRef.argv = args[1];
    captureRef.opts = args[2];
    return makeStubChild();
  });
}

async function runEnvShapeTest() {
  console.log('\n=== A. SAFE_ENV is the exact env passed to spawn ===');
  const captured = {};
  const spy = setupSpy(captured);

  const originalHome = process.env.HOME;
  const baitVars = {
    HOME: '/tmp/leak_canary_home',
    MY_TEST_VAR: 'should_not_leak',
    LD_PRELOAD: '/tmp/evil.so',
    LD_LIBRARY_PATH: '/tmp/evil_lib',
    NODE_OPTIONS: '--inspect=666',
    BASH_ENV: '/tmp/evil.sh',
    PROMPT_COMMAND: 'echo PWN',
  };
  const savedKeys = {};
  for (const [k, v] of Object.entries(baitVars)) {
    savedKeys[k] = process.env[k];
    process.env[k] = v;
  }

  try {
    const validated = parseAndValidate('git status');
    check('git status parses', validated.ok, validated);
    await spawnWithCaps(validated);

    check('HOME is /root (not leaked from process.env.HOME)', captured.opts.env.HOME === '/root', captured.opts.env);
    check('GIT_CONFIG_GLOBAL=/dev/null', captured.opts.env.GIT_CONFIG_GLOBAL === '/dev/null');
    check('GIT_CONFIG_NOSYSTEM=1', captured.opts.env.GIT_CONFIG_NOSYSTEM === '1');
    check("GIT_PAGER='cat'", captured.opts.env.GIT_PAGER === 'cat');
    check("GIT_TERMINAL_PROMPT='0'", captured.opts.env.GIT_TERMINAL_PROMPT === '0');
    check('MY_TEST_VAR NOT propagated', captured.opts.env.MY_TEST_VAR === undefined);
    check('LD_PRELOAD NOT propagated', captured.opts.env.LD_PRELOAD === undefined);
    check('LD_LIBRARY_PATH NOT propagated', captured.opts.env.LD_LIBRARY_PATH === undefined);
    check('NODE_OPTIONS NOT propagated', captured.opts.env.NODE_OPTIONS === undefined);
    check('BASH_ENV NOT propagated', captured.opts.env.BASH_ENV === undefined);
    check('PROMPT_COMMAND NOT propagated', captured.opts.env.PROMPT_COMMAND === undefined);

    const envKeys = Object.keys(captured.opts.env).sort();
    const expectedKeys = Object.keys(SAFE_ENV).sort();
    check('env keys deep-equal SAFE_ENV keys (no extras, no missing)', JSON.stringify(envKeys) === JSON.stringify(expectedKeys), { envKeys, expectedKeys });

    check('shell:false (argv array, never bash-parsed)', captured.opts.shell === false);
    check(`cwd === ${ALLOWED_CWD}`, captured.opts.cwd === ALLOWED_CWD);
    check("stdio === ['ignore','pipe','pipe']", JSON.stringify(captured.opts.stdio) === JSON.stringify(['ignore', 'pipe', 'pipe']));
    check(`timeout === ${SPAWN_TIMEOUT_MS}`, captured.opts.timeout === SPAWN_TIMEOUT_MS);
    check("killSignal === 'SIGKILL'", captured.opts.killSignal === 'SIGKILL');
    check('windowsHide === true', captured.opts.windowsHide === true);
    check('argv[0] is absolute path /usr/bin/git', captured.bin === '/usr/bin/git');
  } finally {
    spy.mock.restore();
    for (const k of Object.keys(baitVars)) {
      if (savedKeys[k] === undefined) delete process.env[k];
      else process.env[k] = savedKeys[k];
    }
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
}

async function runArgvSliceTest() {
  console.log('\n=== B. argv passed to spawn excludes the verb token ===');
  const captured = {};
  const spy = setupSpy(captured);
  try {
    const validated = parseAndValidate('git log --oneline -n 5');
    check('parses', validated.ok);
    await spawnWithCaps(validated);
    check('bin = /usr/bin/git', captured.bin === '/usr/bin/git');
    check("argv === ['log','--oneline','-n','5']", JSON.stringify(captured.argv) === JSON.stringify(['log', '--oneline', '-n', '5']));
  } finally {
    spy.mock.restore();
  }
}

async function runResolvedPathsSubstitutionTest() {
  console.log('\n=== C. resolvedPaths substitution into argv (TOCTOU close) ===');
  const captured = {};
  const spy = setupSpy(captured);
  try {
    // Synthesise a validated result with a resolvedPaths Map. The
    // semantics under test: spawnWithCaps replaces argv[idx] with
    // the Map value for every {idx, real} pair.
    const validated = {
      ok: true,
      argv: ['cat', '/root/QClaw/lexical_input'],
      schemaKey: 'cat',
      verbTokens: 1,
      resolvedPaths: new Map([[1, '/root/QClaw/REAL_TARGET']]),
    };
    await spawnWithCaps(validated);
    check('bin = /bin/cat', captured.bin === '/bin/cat');
    check("argv === ['/root/QClaw/REAL_TARGET']", JSON.stringify(captured.argv) === JSON.stringify(['/root/QClaw/REAL_TARGET']));
  } finally {
    spy.mock.restore();
  }
}

(async function main() {
  try {
    await runEnvShapeTest();
    await runArgvSliceTest();
    await runResolvedPathsSubstitutionTest();
    console.log(`\n=== shell-exec-env-isolation.test.js: ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
  } catch (err) {
    console.error('Unhandled error:', err);
    process.exit(2);
  }
})();
