/**
 * Slice 3d — per-verb schemas unit tests
 *
 * Covers: positive happy paths, every FORBIDDEN flag per design §2,
 * combined-short-flag rejection battery, value-flag rejections incl.
 * the round-3 LOW L6 `git log -n --oneline` mistake, positional count
 * caps, alias `pm2 ls`, and the pm2-binary-existence skip per Blocker 3.
 */

import fs from 'node:fs';
import { parseAndValidate } from '../src/tools/shell-exec-parser.js';
import { VERB_BINARY } from '../src/tools/shell-exec-verb-schemas.js';

let passed = 0;
let failed = 0;
function check(name, cond, detail = null) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`);
    if (detail !== null) console.log(`      ${JSON.stringify(detail).slice(0, 300)}`);
  }
}

function rej(label, input, expectedError, expectedReason) {
  const r = parseAndValidate(input);
  const ok = !r.ok && r.error === expectedError && (!expectedReason || r.reason === expectedReason);
  check(`${label} → ${expectedError}${expectedReason ? '/' + expectedReason : ''}`, ok, r);
}

function ok(label, input, expectSchemaKey) {
  const r = parseAndValidate(input);
  const cond = r.ok && (!expectSchemaKey || r.schemaKey === expectSchemaKey);
  check(`${label} → ok (schemaKey=${expectSchemaKey || 'any'})`, cond, r);
}

console.log('\n=== A. ls happy path ===');
ok('ls (no args)', 'ls', 'ls');
ok('ls /root/QClaw', 'ls /root/QClaw', 'ls');
ok('ls -l /root/QClaw', 'ls -l /root/QClaw', 'ls');
ok('ls -l -a /root/QClaw', 'ls -l -a /root/QClaw', 'ls');
ok('ls --human-readable -l /root/QClaw', 'ls --human-readable -l /root/QClaw', 'ls');

console.log('\n=== B. ls rejections ===');
rej('ls -R (forbidden)', 'ls -R /root/QClaw', 'invalid_flag', 'flag_not_in_v1');
rej('ls --recursive', 'ls --recursive /root/QClaw', 'invalid_flag', 'flag_not_in_v1');
rej('ls --color=always', 'ls --color=always /root/QClaw', 'invalid_flag', 'flag_not_in_v1');
rej('ls /tmp (outside ALLOW)', 'ls /tmp', 'not_in_allow_prefix');
rej('ls /etc (outside ALLOW)', 'ls /etc', 'not_in_allow_prefix');
rej('ls /root/.ssh (DENY)', 'ls /root/.ssh', 'path_denied');
rej('ls relative path', 'ls foo', 'invalid_argument', 'must_be_absolute');

console.log('\n=== C. Combined-short-flag rejection battery (LOW L5) ===');
rej('ls -la', 'ls -la /root/QClaw', 'invalid_flag', 'combined_short_flags');
rej('ls -lh', 'ls -lh /root/QClaw', 'invalid_flag', 'combined_short_flags');
rej('ls -lah', 'ls -lah /root/QClaw', 'invalid_flag', 'combined_short_flags');
// positive controls
ok('ls -l -a (separated)', 'ls -l -a /root/QClaw', 'ls');
ok('ls --human-readable -l (long + short)', 'ls --human-readable -l /root/QClaw', 'ls');
rej('ls -l -la (second-token rejection)', 'ls -l -la /root/QClaw', 'invalid_flag', 'combined_short_flags');

console.log('\n=== D. cat happy + rejections ===');
ok('cat /root/QClaw/package.json (assumes exists)', 'cat /root/QClaw/package.json', 'cat');
rej('cat (no args)', 'cat', 'too_few_arguments');
rej('cat /tmp/x (outside ALLOW)', 'cat /tmp/x', 'not_in_allow_prefix');
rej('cat /root/QClaw/.env (DENY literal)', 'cat /root/QClaw/.env', 'path_denied');
rej('cat /root/.ssh/id_rsa (DENY)', 'cat /root/.ssh/id_rsa', 'path_denied');
rej('cat -n (forbidden flag)', 'cat -n /root/QClaw/package.json', 'invalid_flag');
rej('cat -A (forbidden flag)', 'cat -A /root/QClaw/package.json', 'invalid_flag');
rej('cat --show-all', 'cat --show-all /root/QClaw/package.json', 'invalid_flag');
rej('cat empty quote pos', "cat ''", 'invalid_argument', 'empty_path');
rej('cat 4 paths (over max)', 'cat /root/QClaw/a /root/QClaw/b /root/QClaw/c /root/QClaw/d', 'too_many_arguments');

console.log('\n=== E. git status happy + rejections ===');
ok('git status (no flags)', 'git status', 'git status');
// maxArgvLength=2 for git status, so any extra token rejects via length
// cap first. The flag name doesn't matter — the structural rejection
// is "git status takes no flags or positionals".
rej('git status --porcelain=v2 (length cap)', 'git status --porcelain=v2', 'too_many_arguments', 'argv_length_cap');
rej('git status --ignored', 'git status --ignored', 'too_many_arguments', 'argv_length_cap');
rej('git status -z', 'git status -z', 'too_many_arguments', 'argv_length_cap');
rej('git foo (unknown subcmd)', 'git foo', 'unknown_verb');
rej('git (missing subcmd)', 'git', 'unknown_verb', 'missing_subcommand');

console.log('\n=== F. git log happy + rejections ===');
ok('git log', 'git log', 'git log');
ok('git log --oneline', 'git log --oneline', 'git log');
ok('git log --oneline -n 20', 'git log --oneline -n 20', 'git log');
ok('git log -n 5 --oneline', 'git log -n 5 --oneline', 'git log');
ok('git log --all --graph --oneline', 'git log --all --graph --oneline', 'git log');
ok('git log --max-count=10', 'git log --max-count=10', 'git log');

// L6 — `git log -n --oneline` consumes --oneline as the int value
{
  const r = parseAndValidate('git log -n --oneline');
  const cond = !r.ok && r.error === 'invalid_flag_value' && r.reason && r.reason.includes('-n');
  check('git log -n --oneline (LOW L6 value-flag UX)', cond, r);
}

rej('git log -n 0 (out of range)', 'git log -n 0', 'invalid_flag_value', 'out_of_range');
rej('git log -n 1000 (out of range)', 'git log -n 1000', 'invalid_flag_value', 'out_of_range');
rej('git log -n abc (non-int)', 'git log -n abc', 'invalid_flag_value');
rej('git log --max-count=999 (out of range)', 'git log --max-count=999', 'invalid_flag_value', 'out_of_range');
rej('git log --format=anything (forbidden)', 'git log --format=raw', 'invalid_flag');
// --pretty isn't in allowedFlags; the eq-joiner check finds no matching
// prefix, then findFlagSpec fails → invalid_flag.
{
  const r = parseAndValidate('git log --pretty=format:%H');
  const cond = !r.ok && r.error === 'invalid_flag';
  check('git log --pretty=format:%H → invalid_flag', cond, r);
}
rej('git log --output=/tmp/x', 'git log --output=/tmp/x', 'invalid_flag');
rej('git log -c user.name=foo', 'git log -c user.name=foo', 'invalid_flag');

console.log('\n=== G. pm2 verb dispatch ===');
ok('pm2 list (parse + dispatch only)', 'pm2 list', 'pm2 list');
ok('pm2 ls (alias)', 'pm2 ls', 'pm2 list');
rej('pm2 stop (forbidden)', 'pm2 stop foo', 'unknown_verb');
rej('pm2 restart', 'pm2 restart all', 'unknown_verb');
// pm2 list has maxArgvLength=2 — any extra token rejects via length
// cap (structural — pm2 list takes no flags or positionals).
rej('pm2 list --watch (length cap)', 'pm2 list --watch', 'too_many_arguments', 'argv_length_cap');
rej('pm2 list --silent', 'pm2 list --silent', 'too_many_arguments', 'argv_length_cap');

// pm2 binary-existence guard for the smoke
if (!fs.existsSync(VERB_BINARY.pm2)) {
  console.log(`  [skip] pm2 binary not present at ${VERB_BINARY.pm2} — authoritative pm2-correctness smoke runs post-deploy on qclaw (Appendix C)`);
} else {
  console.log(`  [info] pm2 binary present at ${VERB_BINARY.pm2} (local smoke would work)`);
}

console.log('\n=== H. Verb-name attacks (rejected at parse, included for integration signal) ===');
rej('ls\\nawk …', 'ls\nawk BEGIN', 'rejected_feature', 'newline');
rej('awk … (unknown verb)', 'awk /pattern/', 'unknown_verb');
// Without metachars:
rej('sed (unknown verb)', 'sed foo', 'unknown_verb');
rej('sort (unknown verb)', 'sort foo', 'unknown_verb');
rej('find (unknown verb)', 'find foo', 'unknown_verb');

console.log(`\n=== shell-exec-schemas.test.js: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
