/**
 * Slice 3c.1 — approval-gate allowlist-ordering regression test
 *
 * Asserts ApprovalGate.check('shell_exec', ...) consults the read-only
 * allowlist BEFORE the destructive-pattern and gatedTools steps. The
 * Slice 3c live failure was the gate firing at the gatedTools step
 * for `pm2 list` before the inner allowlist could run.
 *
 * Three property contracts:
 *   1. Allowlisted shell_exec commands return requiresApproval:false
 *      and do not match a destructive pattern.
 *   2. Non-allowlisted shell_exec commands return requiresApproval:
 *      false at the gate — the inner allowlist check in shell-exec.js
 *      owns the {error:'not_allowlisted'} surface. Approval is NOT
 *      the failure shape.
 *   3. Destructive shell_exec commands (e.g. rm -rf) also return
 *      requiresApproval:false at the gate — they are non-allowlisted,
 *      and the inner allowlist rejection runs before the inner
 *      destructive-pattern check inside shell-exec.js. (rm is not on
 *      the allowlist → not_allowlisted error. The DESTRUCTIVE_PATTERNS
 *      inside shell-exec.js exist for cases like a redirect inside an
 *      allowlisted verb, not for the verb itself.)
 *
 * Run: node tests/approval-gate-allowlist-ordering.test.js
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecApprovals } from '../src/security/approvals.js';
import { ApprovalGate } from '../src/security/approval-gate.js';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'qclaw-gate-ordering-'));
  const approvals = new ExecApprovals({ _dir: dir });
  approvals.attach(null);

  // Production-default ApprovalGate config: shell_exec is in gatedTools,
  // no autoApproveTools. This is the exact configuration that exposed
  // the Slice 3c ordering bug.
  const gate = new ApprovalGate(approvals);

  console.log('\n=== Slice 3c.1: approval-gate allowlist-ordering contract ===\n');

  // ── 1. Allowlisted commands bypass the gate ──────────────
  console.log('-- Allowlisted shell_exec commands return requiresApproval:false --');
  const allowed = [
    'pm2 list',
    'ls -la /tmp',
    'cat /tmp/foo',
    'git status --short',
    'git log --oneline -5',
    'grep -rn pattern src/',
    'pm2 logs charlie --nostream --lines 50',
    'grep ERROR /tmp/foo | head -n 20',
    'sudo cat /tmp/foo', // sudo prefix stripped by allowlist
  ];
  for (const cmd of allowed) {
    const r = await gate.check('shell_exec', { command: cmd });
    check(`allowlisted: "${cmd}" -> requiresApproval=false`,
      r.requiresApproval === false,
      JSON.stringify(r));

    // Also assert the destructive-pattern matcher would NOT have caught
    // this. (Defensive — if a future allowlisted verb collides with a
    // destructive pattern, the ordering fix here protects it, but we
    // want to know about the collision.)
    const destructiveHit = gate._matchDestructivePattern('shell_exec', { command: cmd });
    check(`allowlisted: "${cmd}" not flagged by _matchDestructivePattern`,
      destructiveHit === null,
      `matched ${destructiveHit}`);
  }

  // ── 2. Non-allowlisted commands also bypass the gate ─────
  //      (so the inner allowlist in shell-exec.js owns the
  //      {error:'not_allowlisted'} response shape).
  console.log('\n-- Non-allowlisted shell_exec commands return requiresApproval:false at the gate --');
  const notAllowlisted = [
    'whoami',
    'echo hello',
    'pwd',
    'docker ps',
    'systemctl status nginx',
    'curl https://example.com',
    'node -e "process.exit(0)"',
  ];
  for (const cmd of notAllowlisted) {
    const r = await gate.check('shell_exec', { command: cmd });
    check(`non-allowlisted: "${cmd}" -> requiresApproval=false (inner allowlist handles)`,
      r.requiresApproval === false,
      JSON.stringify(r));
  }

  // ── 3. Destructive verbs at the gate ─────────────────────
  //      With the ordering fix, the early shell_exec branch returns
  //      requiresApproval:false for ANY non-empty string command. The
  //      destructive verbs (rm, kill, pm2 stop) are caught downstream
  //      by the inner allowlist in shell-exec.js (not on the allowlist
  //      -> not_allowlisted).
  console.log('\n-- Destructive shell_exec commands return requiresApproval:false at the gate --');
  const destructive = [
    'rm -rf /tmp/x',
    'sudo rm -rf /',
    'kill -9 1234',
    'killall node',
    'pm2 stop charlie',
    'pm2 delete charlie',
    'pm2 restart charlie',
  ];
  for (const cmd of destructive) {
    const r = await gate.check('shell_exec', { command: cmd });
    check(`destructive: "${cmd}" -> requiresApproval=false at gate`,
      r.requiresApproval === false,
      JSON.stringify(r));
  }

  // ── 4. ssh_exec / other tools — original behaviour preserved
  //      The early branch is shell_exec-only. ssh_exec must still go
  //      through destructive-pattern + gatedTools as before.
  console.log('\n-- ssh_exec (not yet allowlisted) still subject to destructive-pattern check --');
  const sshDestructive = await gate.check('ssh_exec', { command: 'rm -rf /tmp/x' });
  check('ssh_exec rm -rf still gated for approval (destructive verb)',
    sshDestructive.requiresApproval === true
      && sshDestructive.riskLevel === 'high'
      && /rm/.test(sshDestructive.reason),
    JSON.stringify(sshDestructive));

  // ── 5. Empty shell_exec command falls through to legacy path
  //      gate's step 4 (gatedTools) catches it — the tool fn will
  //      then reject for missing command if approved. Behaviour is
  //      unchanged from pre-Slice-3c.1 for this edge.
  console.log('\n-- Empty / missing command falls through to legacy gatedTools path --');
  const empty = await gate.check('shell_exec', { command: '' });
  check('shell_exec with empty command -> gatedTools path still gates',
    empty.requiresApproval === true,
    JSON.stringify(empty));

  const missing = await gate.check('shell_exec', {});
  check('shell_exec with missing command -> gatedTools path still gates',
    missing.requiresApproval === true,
    JSON.stringify(missing));

  // ── 6. autoApproveTools still wins over the new step ─────
  console.log('\n-- autoApproveTools short-circuit still runs first --');
  const autoGate = new ApprovalGate(approvals, { autoApproveTools: ['shell_exec'] });
  const auto = await autoGate.check('shell_exec', { command: 'whoami' });
  check('autoApproveTools=[shell_exec] forces requiresApproval=false',
    auto.requiresApproval === false,
    JSON.stringify(auto));

  rmSync(dir, { recursive: true, force: true });
}

main()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('unexpected:', err);
    process.exit(2);
  });
