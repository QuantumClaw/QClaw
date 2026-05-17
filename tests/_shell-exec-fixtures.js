/**
 * Slice 3d test fixture helper — CI parity for shell_exec parser tests.
 *
 * The Slice 3d production parser hardcodes /root/QClaw as ALLOWED_CWD and
 * /root/.ssh, /root/QClaw/.env, /root/QClaw/secrets, etc. as DENY entries.
 * On the qclaw production host those paths exist. On a developer Mac they
 * don't exist (realpath ENOENT → falls back to lexical resolution). On
 * GitHub Actions CI runners they exist but /root is mode 700 owned by
 * root, so realpath('/root/...') as the runner user raises EACCES — and
 * the parser correctly fails closed with realpath_failed/EACCES.
 *
 * Verbatim CI failure (2026-05-17 run 25984954048 on PR #25):
 *
 *   ✗ ls /root/QClaw → ok (schemaKey=ls)
 *       {"ok":false,"error":"invalid_argument","reason":"realpath_failed",
 *        "detail":{"lexical":"/root/QClaw","resolved":"/root/QClaw",
 *                  "errCode":"EACCES","positionalIndex":0}}
 *   ✗ cat /root/QClaw/package.json (assumes exists) → ok (schemaKey=cat)
 *       {"ok":false,"error":"invalid_argument","reason":"realpath_failed",
 *        "detail":{"lexical":"/root/QClaw/package.json",
 *                  "resolved":"/root/QClaw/package.json",
 *                  "errCode":"EACCES","positionalIndex":0}}
 *
 *   (10 such failures across schemas.test.js / path-resolve.test.js /
 *    approval-gate-shell-exec-parser.test.js after the lexical-DENY
 *    pre-check fix.)
 *
 * The fix splits realpath-touching assertions into TWO categories:
 *
 *   (a) Lexical-rejection tests (relative-path, lexical-DENY before
 *       realpath, must_be_absolute, glob_or_brace, etc.) — these never
 *       call realpath under the lexical-pre-check fix, so they continue
 *       to use the production /root paths for accurate coverage of the
 *       prod DENY surface.
 *
 *   (b) Realpath-touching tests (ALLOW-pass happy paths, symlink-into-
 *       DENY, resolvedPaths substitution semantics, parseAndValidate
 *       happy-path) — these MUST use a writable fixture directory under
 *       /tmp. The parser is fed a per-test-run options object pointing
 *       ALLOW/DENY/ALLOWED_CWD at the fixture root.
 *
 * Production semantics are unchanged — createFixture is only imported
 * by test files, and parseAndValidate(command) without options uses the
 * frozen production constants.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * createFixture() → { root, cleanup }
 *
 * Creates a per-test-run /tmp/qclaw-test-<random>/ directory that mirrors
 * the production /root/QClaw + /root/.ssh + /root/.quantumclaw layout:
 *
 *   <root>/
 *     package.json                    — small JSON, for cat happy-path
 *     src/
 *       index.js                      — for ls happy-path
 *     .env                            — DENY target ("FAKE_SECRET=test")
 *     .git/
 *       config                        — clean repo-local config
 *       HEAD                          — minimal HEAD ref
 *     credentials.json                — DENY target ("{}")
 *     secrets/
 *       api_key.txt                   — DENY prefix target
 *     data/
 *       dump.sql                      — DENY glob *.sql target
 *     node_modules/
 *       some_pkg/.env                 — DENY glob **\/.env target
 *     .ssh/
 *       id_rsa                        — DENY target ("FAKE_PRIVATE_KEY")
 *     .quantumclaw/
 *       config.json                   — "{}"
 *       .env                          — "FAKE_QC_SECRET=test"
 *     symlink_to_id_rsa → .ssh/id_rsa — for realpath-follows-symlink-DENY
 *
 * Uses fs.mkdtempSync('/tmp/qclaw-test-') for the unique root, which
 * handles parallel test runs better than <pid>.
 *
 * cleanup() is fs.rmSync(root, { recursive:true, force:true }). Call in
 * afterAll / finally. Safe to call multiple times.
 */
export function createFixture() {
  // mkdtempSync may return a non-canonical path (notably on macOS where
  // /tmp and /var/folders/... are symlinked to /private/tmp and
  // /private/var/folders/...). Canonicalise immediately — the ALLOW
  // check inside resolvePath compares against `real` (post-realpath),
  // so the override list MUST contain the canonical root. Without this,
  // every fixture-based ALLOW happy-path would fail on macOS with
  // not_in_allow_prefix.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qclaw-test-')));

  // Top-level files / dirs
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"qclaw-test-fixture","version":"0.0.0"}\n');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), '// fixture index.js\n');

  // DENY targets — literal files / dirs
  fs.writeFileSync(path.join(root, '.env'), 'FAKE_SECRET=test\n');
  fs.writeFileSync(path.join(root, 'credentials.json'), '{}\n');
  fs.mkdirSync(path.join(root, 'secrets'));
  fs.writeFileSync(path.join(root, 'secrets', 'api_key.txt'), 'FAKE\n');

  // DENY glob targets — /root/QClaw/data/*.sql + /root/QClaw/node_modules/**/.env
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'dump.sql'), '-- fake dump\n');
  fs.mkdirSync(path.join(root, 'node_modules', 'some_pkg'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'some_pkg', '.env'), 'FAKE_PKG_SECRET=test\n');

  // .git/config — clean (no dangerous keys). The git-config-safety test
  // does not consume this fixture (it scans the live repo's .git/config
  // via `git config --list --local`), but the layout mirror is part of
  // the fixture-mirrors-production contract.
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'config'), '[core]\n\trepositoryformatversion = 0\n');
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');

  // Mirror /root/.ssh — sibling of <root> in prod, but for the fixture
  // we co-locate under <root>/.ssh so a single cleanup() covers
  // everything. The DENY override lists the fixture .ssh path.
  fs.mkdirSync(path.join(root, '.ssh'));
  fs.writeFileSync(path.join(root, '.ssh', 'id_rsa'), 'FAKE_PRIVATE_KEY\n');

  // Mirror /root/.quantumclaw — same colocation rationale.
  fs.mkdirSync(path.join(root, '.quantumclaw'));
  fs.writeFileSync(path.join(root, '.quantumclaw', 'config.json'), '{}\n');
  fs.writeFileSync(path.join(root, '.quantumclaw', '.env'), 'FAKE_QC_SECRET=test\n');

  // Symlink to a DENY target — for symlink-into-DENY realpath coverage.
  // Symlink creation may fail on filesystems without symlink support;
  // tests that need it should check fs.existsSync(symlinkPath) post-call.
  try {
    fs.symlinkSync(
      path.join(root, '.ssh', 'id_rsa'),
      path.join(root, 'symlink_to_id_rsa'),
    );
  } catch (err) {
    // Filesystems without symlink support (some Windows configs, some
    // restrictive sandboxes) — tests can detect the missing symlink and
    // skip with a clear message. The remainder of the fixture is still
    // useful.
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
      // Best-effort — fixture lives in /tmp and will be reaped on
      // reboot. We don't fail tests on cleanup races.
    }
  };

  return { root, cleanup };
}

/**
 * makeTestOverrides(fixtureRoot) → options object for parseAndValidate.
 *
 * The returned object's shape matches the parseAndValidate(command,
 * options) DI contract:
 *
 *   {
 *     allowedCwd: <fixtureRoot>,
 *     denyPrefixes: [...DENY entries rooted at fixtureRoot...],
 *     denyGlobs:    [...DENY glob patterns rooted at fixtureRoot...],
 *     allowedPrefixesPerVerb: {
 *       ls:  [<fixtureRoot>],
 *       cat: [<fixtureRoot>],
 *     },
 *   }
 *
 * Mirrors production DENY structure exactly, just rebased onto
 * fixtureRoot. /etc/* and /proc/* DENY entries are NOT included — the
 * fixture only covers the /root/QClaw + /root/.ssh + /root/.quantumclaw
 * surface. Tests that need /etc/* DENY coverage exercise it via the
 * matchesDeny() pure-function path (no fixture needed — see
 * tests/shell-exec-path-resolve.test.js §B).
 */
export function makeTestOverrides(fixtureRoot) {
  return {
    allowedCwd: fixtureRoot,
    denyPrefixes: [
      // Note: /proc and /etc/* prefixes are not rebased — those are
      // covered by the matchesDeny pure-function tests using the
      // production DENY_PREFIXES export directly.
      path.join(fixtureRoot, '.ssh'),
      path.join(fixtureRoot, '.aws'),
      path.join(fixtureRoot, '.config', 'gh'),
      path.join(fixtureRoot, '.gnupg'),
      path.join(fixtureRoot, '.docker'),
      path.join(fixtureRoot, '.npmrc'),
      path.join(fixtureRoot, '.bash_history'),
      path.join(fixtureRoot, '.gitconfig'),
      path.join(fixtureRoot, '.quantumclaw', '.env'),
      path.join(fixtureRoot, '.quantumclaw', '.secrets'),
      path.join(fixtureRoot, '.quantumclaw', '.secrets.enc'),
      path.join(fixtureRoot, '.quantumclaw', 'config.json'),
      path.join(fixtureRoot, '.git', 'config'),
      path.join(fixtureRoot, '.env'),
      path.join(fixtureRoot, 'credentials.json'),
      path.join(fixtureRoot, 'secrets'),
    ],
    denyGlobs: [
      // Globs are anchored to fixtureRoot. The ** semantics from
      // src/tools/shell-exec-verb-schemas.js carry through unchanged
      // (no path-pattern syntax differences between prod and fixture).
      `${fixtureRoot}/**/.env`,
      `${fixtureRoot}/**/.env.*`,
      `${fixtureRoot}/**/credentials*.json`,
      `${fixtureRoot}/data/*.sql`,
      `${fixtureRoot}/node_modules/**/.env`,
    ],
    allowedPrefixesPerVerb: {
      ls: [fixtureRoot],
      cat: [fixtureRoot],
    },
  };
}
