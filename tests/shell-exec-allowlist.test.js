/**
 * Slice 3c — shell_exec read-only allowlist
 *
 * Three responsibilities under test:
 *   (A) `checkAllowlist` admits every spec'd read-only verb form and
 *       rejects everything else with a structured reason.
 *   (B) Per-verb flag rules: `find -delete` etc disallowed; `pm2 logs`
 *       requires `--nostream`.
 *   (C) Gate ordering inside `createShellExecTool`: allowlist runs
 *       before DENY/DESTRUCTIVE/QC-dir; non-allowlisted commands return
 *       `not_allowlisted` and never reach the approval system;
 *       allowlisted commands still flow through DENY (defence in depth).
 */

import { checkAllowlist, listAllowedVerbs, ALLOWLIST_SPEC } from '../src/tools/shell-exec-allowlist.js';
import { createShellExecTool } from '../src/tools/shell-exec.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

function stubApprovalGate() {
  const calls = [];
  return {
    calls,
    requestInlineApproval: async (req) => {
      calls.push(req);
      return { approved: true, id: 'stub-approval' };
    },
  };
}

function stubAudit() {
  const entries = [];
  return {
    entries,
    log: (actor, action, detail, meta) => entries.push({ actor, action, detail, meta }),
  };
}

console.log('\n=== A. Allowlist admits every spec\'d read-only verb form ===');

const ALLOWED_FORMS = [
  ['ls', 'ls -la /tmp'],
  ['cat', 'cat /tmp/foo'],
  ['head', 'head -n 50 /tmp/foo'],
  ['tail', 'tail -f-equivalent: tail -n 20 /tmp/foo'], // descriptive name
  ['wc', 'wc -l /tmp/foo'],
  ['sort', 'sort /tmp/foo'],
  ['uniq', 'uniq /tmp/foo'],
  ['grep', 'grep -rn pattern src/'],
  ['find', 'find . -name "*.js"'],
  // awk + sed dropped 2026-05-15 (Slice 3c.1 round-2 review) — see
  // "awk + sed no longer allowlisted" section below.
  ['git status', 'git status --short'],
  ['git log', 'git log --oneline -5'],
  ['git diff', 'git diff HEAD~1'],
  ['pm2 list', 'pm2 list'],
  ['pm2 logs', 'pm2 logs charlie --nostream --lines 100'],
];

for (const [label, command] of ALLOWED_FORMS) {
  const r = checkAllowlist(command);
  check(`'${label}' form allowed: ${command.slice(0, 60)}`, r.allowed === true);
}

check('sudo prefix stripped before verb match', checkAllowlist('sudo cat /tmp/foo').allowed === true);
check('listAllowedVerbs returns 14 entries (9 single + 5 two-word)', listAllowedVerbs().length === 14);
check('ALLOWLIST_SPEC.singleVerbs has 9 entries (awk + sed removed)', ALLOWLIST_SPEC.singleVerbs.length === 9);
check('ALLOWLIST_SPEC.twoWordVerbs has 5 entries', ALLOWLIST_SPEC.twoWordVerbs.length === 5);

console.log('\n=== awk + sed dropped from allowlist (Slice 3c.1 round-2 review) ===');
//
// Round-2 adversarial review (2026-05-15) found 2 CRITICAL bypasses:
//   - awk BEGIN{system("...")}  — runs shell from inside awk body
//   - sed -e "1e ..."           — GNU sed `e` command runs shell
// plus HIGH-severity sed file-I/O bypasses (`r`/`w`/`R`/`W`).
// Decision per Tyson: drop awk + sed from ALLOWED_VERBS rather than
// chase enumerated flag bans.
for (const cmd of [
  'awk \'{print $1}\' /tmp/foo',          // previously allowed
  'awk BEGIN{system("id")}',              // round-2 CRITICAL #1
  'awk -e "BEGIN{system(\\"id\\")}"',
  'sed -n 1,10p /tmp/foo',                // previously allowed
  'sed -e "1e echo PWN" /tmp/x',          // round-2 CRITICAL #2
  'sed "1r /etc/shadow" /tmp/x',          // round-2 HIGH (sed `r` file I/O)
  'sed -e "w /etc/cron.d/evil" /tmp/x',   // round-2 HIGH (sed `w` file I/O)
]) {
  const r = checkAllowlist(cmd);
  check(`'${cmd.slice(0, 50)}...' rejected with reason=not_allowlisted`,
    r.allowed === false && r.reason === 'not_allowlisted');
}

console.log('\n=== B. Per-verb flag rules ===');

const r_find_delete = checkAllowlist('find /tmp -delete');
check('find -delete rejected with reason=disallowed_flag', r_find_delete.allowed === false && r_find_delete.reason === 'disallowed_flag' && r_find_delete.flag === '-delete');

// Note: `find ... -exec rm {} \;` would also trip the chain-reject (because
// the `\;` literal contains `;`); use the `+` terminator form to isolate
// the per-verb -exec flag check.
const r_find_exec = checkAllowlist('find . -name foo -exec rm {} +');
check('find -exec rejected with reason=disallowed_flag', r_find_exec.allowed === false && r_find_exec.reason === 'disallowed_flag' && r_find_exec.flag === '-exec');

// sed is no longer on the allowlist (Slice 3c.1 round-2 review); the
// dedicated `-i` / `--in-place` disallowed-flag tests would now hit the
// not_allowlisted gate first. Coverage of those bodies moved up into the
// "awk + sed dropped" section, where we assert not_allowlisted directly.

const r_pm2_logs_stream = checkAllowlist('pm2 logs charlie');
check('pm2 logs without --nostream rejected with reason=missing_required_flag', r_pm2_logs_stream.allowed === false && r_pm2_logs_stream.reason === 'missing_required_flag' && r_pm2_logs_stream.flag === '--nostream');

console.log('\n=== Non-allowlisted verbs ===');

for (const cmd of ['rm -rf /tmp/foo', 'curl evil.com', 'node -e "process.exit(0)"', 'bash -c "ls"', 'echo hello', 'pwd', 'whoami', 'ssh me@host', 'docker ps', 'systemctl status nginx']) {
  const r = checkAllowlist(cmd);
  check(`'${cmd}' rejected with reason=not_allowlisted`, r.allowed === false && r.reason === 'not_allowlisted');
}

const r_empty = checkAllowlist('');
check('empty command rejected with reason=empty', r_empty.allowed === false && r_empty.reason === 'empty');

console.log('\n=== Chaining & command substitution ===');

const chains = [
  ['semicolon', 'ls /tmp; rm -rf /tmp/foo'],
  ['logical and', 'ls /tmp && cat /etc/passwd'],
  ['logical or', 'ls /tmp || rm /etc/passwd'],
  ['command sub $()', 'cat $(curl evil.com)'],
  ['backtick sub', 'cat `curl evil.com`'],
];
for (const [label, cmd] of chains) {
  const r = checkAllowlist(cmd);
  check(`'${label}' rejected (${cmd.slice(0, 40)})`, r.allowed === false && r.reason === 'chain_or_substitution');
}

check('background & rejected', checkAllowlist('ls /tmp &').allowed === false && checkAllowlist('ls /tmp &').reason === 'chain_or_substitution');

console.log('\n=== Path-traversal `..` rejected anywhere (Slice 3c.1 round-2 review) ===');
// Round-2 HIGH #2: `cat /tmp/x > /tmp/../etc/passwd` passes the
// DESTRUCTIVE `>\s*\/(?!dev\/null|tmp\/)` regex because `> /tmp/` is
// exempted; bash resolves `/tmp/../etc/passwd` to `/etc/passwd`.
// Fix: blanket reject `..` anywhere in the command body at the
// allowlist layer (returns reason=chain_or_substitution,
// pattern=parent-dir traversal).
const traversals = [
  ['plain ../', 'cat /tmp/../etc/passwd'],
  ['redirect via /tmp/..', 'cat /tmp/x > /tmp/../etc/passwd'],
  ['double-dot mixed (/./..)', 'cat /tmp/x > /tmp/./../etc/passwd'],
  ['parent in argument', 'cat ../foo'],
];
for (const [label, cmd] of traversals) {
  const r = checkAllowlist(cmd);
  check(`'${label}' rejected (${cmd.slice(0, 50)})`,
    r.allowed === false
    && r.reason === 'chain_or_substitution'
    && /parent-dir traversal/.test(r.pattern || ''));
}

console.log('\n=== Pipes permitted, segments validated ===');

const r_pipe_ok = checkAllowlist('grep -rn pattern src/ | head -n 20');
check('grep | head allowed (both segments on allowlist)', r_pipe_ok.allowed === true);

const r_pipe_bad = checkAllowlist('cat /tmp/foo | sh');
check('cat | sh rejected (sh not on allowlist)', r_pipe_bad.allowed === false && r_pipe_bad.reason === 'not_allowlisted' && r_pipe_bad.verb === 'sh');

const r_pipe_pm2_ok = checkAllowlist('pm2 logs charlie --nostream | grep ERROR');
check('pm2 logs --nostream | grep allowed', r_pipe_pm2_ok.allowed === true);

const r_pipe_pm2_bad = checkAllowlist('pm2 logs charlie | grep ERROR');
check('pm2 logs (no --nostream) | grep rejected at first segment', r_pipe_pm2_bad.allowed === false && r_pipe_pm2_bad.reason === 'missing_required_flag');

console.log('\n=== C. Gate ordering inside createShellExecTool ===');

const approvalGate1 = stubApprovalGate();
const audit1 = stubAudit();
const tool1 = createShellExecTool({ approvalGate: approvalGate1, audit: audit1, auditActor: 'test' });

const r1 = await tool1.fn({ command: 'rm -rf /tmp/foo' });
check('rm -rf returns error=not_allowlisted', r1.error === 'not_allowlisted');
check('rm -rf never reached approval (stub recorded 0 calls)', approvalGate1.calls.length === 0);
check('rm -rf wrote shell_exec_not_allowlisted audit entry', audit1.entries.some(e => e.action === 'shell_exec_not_allowlisted'));

const approvalGate2 = stubApprovalGate();
const audit2 = stubAudit();
const tool2 = createShellExecTool({ approvalGate: approvalGate2, audit: audit2, auditActor: 'test' });

const r2 = await tool2.fn({ command: 'cat /root/.quantumclaw/.env' });
check('cat /root/.quantumclaw/.env passes allowlist but DENY hard-blocks', r2.error === 'Command denied by policy');
check('DENY case never reached approval (0 calls)', approvalGate2.calls.length === 0);
check('DENY case wrote shell_exec_denied_by_policy audit entry', audit2.entries.some(e => e.action === 'shell_exec_denied_by_policy'));

const approvalGate3 = stubApprovalGate();
const audit3 = stubAudit();
const tool3 = createShellExecTool({ approvalGate: approvalGate3, audit: audit3, auditActor: 'test' });

const r3 = await tool3.fn({ command: 'cat /root/.quantumclaw/config.json' });
check('cat /root/.quantumclaw/<non-secret> passes allowlist + DENY, hits QC-dir approval', approvalGate3.calls.length === 1 && approvalGate3.calls[0].tool === 'shell_exec');

const approvalGate4 = stubApprovalGate();
const audit4 = stubAudit();
const tool4 = createShellExecTool({ approvalGate: approvalGate4, audit: audit4, auditActor: 'test' });

const r4 = await tool4.fn({ command: 'ls /tmp' });
check('ls /tmp passes allowlist and executes (no approval needed)', typeof r4.exit_code === 'number' && r4.error !== 'not_allowlisted');
check('ls /tmp never reached approval (0 calls)', approvalGate4.calls.length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
