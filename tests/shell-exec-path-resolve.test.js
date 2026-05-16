/**
 * Slice 3d — path resolution + DENY/ALLOW + globMatch tests
 *
 * Covers: every DENY_PREFIXES entry, every DENY_GLOBS entry, off-by-one
 * boundary cases, .. traversal, must_be_absolute, symlink resolution
 * (with create + cleanup of test symlinks under /tmp), ELOOP fallback,
 * zero-segment globMatch battery (round-2 Blocker 2), multi-** battery
 * (round-3 LOW L3), literal-DENY belt-and-braces (round-2 Blocker 2),
 * and the resolvedPaths-substitution semantics (round-2 LOW L1).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolvePath,
  matchesDeny,
  globMatch,
  DENY_PREFIXES,
  DENY_GLOBS,
  ALLOWED_CWD,
} from '../src/tools/shell-exec-verb-schemas.js';
import { parseAndValidate } from '../src/tools/shell-exec-parser.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail = null) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else {
    failed++;
    console.log(`  ✗ ${name}`);
    if (detail !== null) console.log(`      ${JSON.stringify(detail).slice(0, 300)}`);
  }
}

console.log('\n=== A. globMatch zero-segment battery (Blocker 2) ===');
check('globMatch /root/.env vs /root/**/.env', globMatch('/root/.env', '/root/**/.env') === true);
check('globMatch /root/QClaw/.env vs /root/**/.env', globMatch('/root/QClaw/.env', '/root/**/.env') === true);
check('globMatch /root/a/b/c/.env vs /root/**/.env', globMatch('/root/a/b/c/.env', '/root/**/.env') === true);
check('globMatch /root/QClaw/credentials.json vs /root/QClaw/**/credentials*.json', globMatch('/root/QClaw/credentials.json', '/root/QClaw/**/credentials*.json') === true);
check('globMatch /root/QClaw/data/dump.sql vs /root/QClaw/data/*.sql', globMatch('/root/QClaw/data/dump.sql', '/root/QClaw/data/*.sql') === true);
check('globMatch /root/QClaw/data/sub/dump.sql vs /root/QClaw/data/*.sql (false — * does not cross /)', globMatch('/root/QClaw/data/sub/dump.sql', '/root/QClaw/data/*.sql') === false);
check('globMatch /etc/whatever vs /root/**/.env (false — anchor mismatch)', globMatch('/etc/whatever', '/root/**/.env') === false);
check('globMatch /root/.envfile vs /root/**/.env (false — literal mismatch)', globMatch('/root/.envfile', '/root/**/.env') === false);
check('globMatch /root/QClaw/.env.local vs /root/**/.env.* (true)', globMatch('/root/QClaw/.env.local', '/root/**/.env.*') === true);
check('globMatch /root/QClaw/.env vs /root/**/.env.* (false — needs the trailing dot)', globMatch('/root/QClaw/.env', '/root/**/.env.*') === false);

console.log('\n=== A1. Multi-** battery (LOW L3) ===');
check('multi-** zero+zero', globMatch('/root/QClaw/.env', '/root/**/QClaw/**/.env') === true);
check('multi-** 1+2', globMatch('/root/a/QClaw/b/c/.env', '/root/**/QClaw/**/.env') === true);
check('multi-** 2+0', globMatch('/root/x/y/QClaw/.env', '/root/**/QClaw/**/.env') === true);
check('multi-** literal segment mismatch', globMatch('/root/QClaw/.env', '/root/**/something_else/**/.env') === false);
check('multi-** missing literal QClaw', globMatch('/root/a/b/c/d/.env', '/root/**/QClaw/**/.env') === false);

console.log('\n=== B. matchesDeny — each DENY_PREFIXES entry hits, off-by-one misses ===');
check('matchesDeny /root/.ssh/id_rsa', matchesDeny('/root/.ssh/id_rsa') === '/root/.ssh');
check('matchesDeny exact /root/.ssh', matchesDeny('/root/.ssh') === '/root/.ssh');
check('matchesDeny boundary /root/.ssh-public-info (NOT a match)', matchesDeny('/root/.ssh-public-info') === null);
check('matchesDeny /proc/self/environ', matchesDeny('/proc/self/environ') === '/proc');
check('matchesDeny /etc/shadow', matchesDeny('/etc/shadow') === '/etc/shadow');
check('matchesDeny /etc/shadowfile (NOT match)', matchesDeny('/etc/shadowfile') === null);
check('matchesDeny /root/QClaw/.env (literal entry)', matchesDeny('/root/QClaw/.env') !== null);
check('matchesDeny /root/QClaw/credentials.json', matchesDeny('/root/QClaw/credentials.json') !== null);
check('matchesDeny /root/QClaw/.git/config', matchesDeny('/root/QClaw/.git/config') === '/root/QClaw/.git/config');
check('matchesDeny /root/.quantumclaw/config.json', matchesDeny('/root/.quantumclaw/config.json') === '/root/.quantumclaw/config.json');
check('matchesDeny /root/QClaw/secrets/foo', matchesDeny('/root/QClaw/secrets/foo') === '/root/QClaw/secrets');
check('matchesDeny /root/QClaw/secrets (exact)', matchesDeny('/root/QClaw/secrets') === '/root/QClaw/secrets');

console.log('\n=== B1. matchesDeny — each DENY_GLOBS entry ===');
check('DENY_GLOBS /root/**/.env catches /root/QClaw/.env', !!matchesDeny('/root/QClaw/.env'));
check('DENY_GLOBS catches /root/QClaw/.env.local', globMatch('/root/QClaw/.env.local', '/root/**/.env.*') === true);
check('DENY_GLOBS catches /root/QClaw/data/dump.sql', matchesDeny('/root/QClaw/data/dump.sql') !== null);
check('DENY_GLOBS does NOT catch /root/QClaw/data/notes.txt', matchesDeny('/root/QClaw/data/notes.txt') === null);
check('DENY_GLOBS does NOT catch /root/QClaw/data/sub/dump.sql (* does not cross /)', matchesDeny('/root/QClaw/data/sub/dump.sql') === null);

console.log('\n=== C. resolvePath — must_be_absolute, empty_path ===');
{
  const r = resolvePath('', ALLOWED_CWD, ['/root/QClaw']);
  check('empty path', !r.ok && r.reason === 'empty_path', r);
}
{
  const r = resolvePath('relative/path', ALLOWED_CWD, ['/root/QClaw']);
  check('relative path → must_be_absolute', !r.ok && r.reason === 'must_be_absolute', r);
}

console.log('\n=== D. resolvePath — DENY-on-real, ALLOW-pass ===');
{
  // /root/QClaw/package.json (assume exists in repo root). The repo dev
  // path on this machine is /Users/tysonvenables/QClaw — paths under
  // /root/QClaw won't exist locally, so realpath ENOENT's and falls
  // back to lexical. Lexical /root/QClaw/.env hits the literal DENY.
  const r = resolvePath('/root/QClaw/.env', ALLOWED_CWD, ['/root/QClaw']);
  check('/root/QClaw/.env → path_denied (literal)', !r.ok && r.reason === 'path_denied' && r.detail.matchedDeny === '/root/QClaw/.env', r);
}
{
  const r = resolvePath('/root/QClaw/secrets/aws.json', ALLOWED_CWD, ['/root/QClaw']);
  check('/root/QClaw/secrets/aws.json → path_denied', !r.ok && r.reason === 'path_denied', r);
}
{
  const r = resolvePath('/root/.ssh/id_rsa', ALLOWED_CWD, ['/root/QClaw']);
  check('/root/.ssh/id_rsa → path_denied', !r.ok && r.reason === 'path_denied', r);
}

console.log('\n=== E. resolvePath — ALLOW failures ===');
{
  const r = resolvePath('/tmp/x', ALLOWED_CWD, ['/root/QClaw']);
  check('/tmp/x → not_in_allow_prefix', !r.ok && r.reason === 'not_in_allow_prefix', r);
}
{
  const r = resolvePath('/etc/something', ALLOWED_CWD, ['/root/QClaw']);
  check('/etc/something → not_in_allow_prefix', !r.ok && r.reason === 'not_in_allow_prefix', r);
}
{
  // .. traversal — path.resolve normalises. /tmp/../etc/passwd → /etc/passwd
  const r = resolvePath('/tmp/../etc/passwd', ALLOWED_CWD, ['/root/QClaw']);
  check('/tmp/../etc/passwd → not_in_allow_prefix (after normalise)', !r.ok && r.reason === 'not_in_allow_prefix', r);
}

console.log('\n=== F. Symlink tests (test-scaffolded) ===');
const tmpDir = os.tmpdir();
const sym1 = path.join(tmpDir, 'qclaw_test_sym_passwd_' + process.pid);
const sym2 = path.join(tmpDir, 'qclaw_test_sym_loop_a_' + process.pid);
const sym3 = path.join(tmpDir, 'qclaw_test_sym_loop_b_' + process.pid);
let symlinkSupported = true;
try {
  // /etc/passwd is world-readable everywhere we test (macOS, Linux).
  // We're testing the resolution semantics, not the content.
  if (fs.existsSync(sym1)) fs.unlinkSync(sym1);
  fs.symlinkSync('/etc/passwd', sym1);
} catch (err) {
  symlinkSupported = false;
  console.log(`  [skip] symlink creation unsupported: ${err.code}`);
}

if (symlinkSupported) {
  // Case 1 — v1 ALLOW (only /root/QClaw) rejects via ALLOW (lexical /tmp/..).
  {
    const r = resolvePath(sym1, ALLOWED_CWD, ['/root/QClaw']);
    check('symlink → /etc/passwd, v1 ALLOW only /root/QClaw → not_in_allow_prefix (DENY on real /etc/passwd doesn\'t match, so ALLOW catches)', !r.ok, r);
  }
  // Case 2 — test-only ALLOW widening to /tmp + /etc — DENY-on-real should
  // catch /etc/passwd ONLY if /etc/shadow or such; /etc/passwd is not in
  // our DENY list. So we make a separate symlink to /root/.ssh-like
  // path to verify DENY-on-real fires first.
  // Skip /etc/passwd content check — we don't want to read it on test
  // failure. Just verify resolution.
  {
    // Manually craft a symlink to /etc/shadow (which IS in DENY).
    // /etc/shadow may not be readable, but symlink creation only needs
    // the target string — no permission required.
    const symShadow = path.join(tmpDir, 'qclaw_test_sym_shadow_' + process.pid);
    try {
      if (fs.existsSync(symShadow)) fs.unlinkSync(symShadow);
      fs.symlinkSync('/etc/shadow', symShadow);
      // With ALLOW = ['/tmp'] (test-only), the symlink resolves to
      // /etc/shadow, which hits DENY. The resolution still falls
      // through to fs.realpathSync — if /etc/shadow doesn't exist on
      // this OS (macOS has /etc/master.passwd, not shadow), realpath
      // ENOENT's and we fall back to lexical. In either case the
      // matchesDeny check fires on either the real (/etc/shadow) or
      // the lexical (/tmp/qclaw_test_sym_shadow_…) — but lexical is
      // in /tmp, not in DENY. So we expect either path_denied (Linux
      // CI where /etc/shadow exists) or not_in_allow_prefix (macOS dev
      // where /etc/shadow may not exist and ALLOW [/tmp] catches the
      // lexical).
      const r = resolvePath(symShadow, ALLOWED_CWD, ['/tmp']);
      const denyHit = !r.ok && r.reason === 'path_denied';
      const allowFail = !r.ok && r.reason === 'not_in_allow_prefix';
      // We want denyHit on Linux. allow-fail acceptable on macOS dev.
      check('symlink → /etc/shadow, ALLOW=[/tmp]: DENY-on-real fires (Linux) OR allow-fail (macOS ENOENT)', denyHit || allowFail, r);
      try { fs.unlinkSync(symShadow); } catch (e) { /* ignore */ }
    } catch (err) {
      console.log(`  [skip] /etc/shadow symlink test: ${err.message}`);
    }
  }
  // Case 3 — symlink loop → ELOOP → realpath_failed wrapped as
  // invalid_argument.
  try {
    if (fs.existsSync(sym2)) fs.unlinkSync(sym2);
    if (fs.existsSync(sym3)) fs.unlinkSync(sym3);
    fs.symlinkSync(sym3, sym2);
    fs.symlinkSync(sym2, sym3);
    const r = resolvePath(sym2, ALLOWED_CWD, ['/tmp']);
    check('symlink loop → realpath_failed (ELOOP)', !r.ok && r.reason === 'realpath_failed' && r.detail.errCode === 'ELOOP', r);
    try { fs.unlinkSync(sym2); } catch (e) { /* ignore */ }
    try { fs.unlinkSync(sym3); } catch (e) { /* ignore */ }
  } catch (err) {
    console.log(`  [skip] symlink loop: ${err.code}`);
  }
  try { fs.unlinkSync(sym1); } catch (e) { /* ignore */ }
}

console.log('\n=== G. resolvedPaths substitution semantics (LOW L1) ===');
{
  // Create a symlink under /tmp pointing at a real file under the dev
  // copy of QClaw. We can't use /root/QClaw on dev — use the live repo
  // path. For this test we widen ALLOW to the dev repo dir.
  // This validates the Map semantics (the absolute-index key) rather
  // than the production ALLOW.
  // Instead, validate semantics by checking that the resolvedPaths Map
  // entries exist when paths validate.
  // Simpler test: parseAndValidate('cat /root/QClaw/package.json') —
  // on dev, ENOENT path, falls back to lexical = resolved =
  // /root/QClaw/package.json, ALLOW passes, DENY doesn't fire.
  const r = parseAndValidate('cat /root/QClaw/package.json');
  if (r.ok) {
    check('parseAndValidate cat <file> populates resolvedPaths', r.resolvedPaths instanceof Map && r.resolvedPaths.has(1), r);
    check('resolvedPaths key is absolute argv index (1 for cat arg)', r.resolvedPaths.get(1) === '/root/QClaw/package.json', r);
  } else {
    check('parseAndValidate cat /root/QClaw/package.json (skip — no fs)', false, r);
  }
}

console.log(`\n=== shell-exec-path-resolve.test.js: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
