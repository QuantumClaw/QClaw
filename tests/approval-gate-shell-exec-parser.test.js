/**
 * Slice 3d — approval-gate parser-bypass regression test
 *
 * Ports tests/approval-gate-allowlist-ordering.test.js (Slice 3c.1) to
 * the Slice 3d structural model. The Slice 3c.1 ordering guarantee
 * survives unchanged — the gate consults parseAndValidate (not the
 * deleted checkAllowlist) and returns requiresApproval:false for both
 * ok and not-ok results, deferring to the tool body for the response
 * shape.
 *
 * Property contracts (same shape as 3c.1, retargeted to the parser):
 *   1. Parser-OK shell_exec commands return requiresApproval:false and
 *      do not match a destructive pattern.
 *   2. Parser-REJECT shell_exec commands also return requiresApproval:
 *      false at the gate — the tool body owns the structured rejection
 *      shape (single source of truth).
 *   3. Destructive shell_exec commands (rm, kill, etc — all unknown_verb
 *      under Slice 3d) return requiresApproval:false at the gate; the
 *      tool body rejects with error=unknown_verb.
 *   4. Newline-injection regression: `pm2 list\necho pwned` rejects
 *      structurally as error=rejected_feature, reason=newline.
 *      Notifier never fires.
 *
 * Run: node tests/approval-gate-shell-exec-parser.test.js
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecApprovals } from '../src/security/approvals.js';
import { ApprovalGate } from '../src/security/approval-gate.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createShellExecTool } from '../src/tools/shell-exec.js';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'qclaw-gate-parser-'));
  const approvals = new ExecApprovals({ _dir: dir });
  approvals.attach(null);

  const gate = new ApprovalGate(approvals);

  console.log('\n=== Slice 3d: approval-gate parser-bypass contract ===\n');

  // ── 1. Parser-OK commands bypass the gate ──────────────
  // The Slice 3d v1 ALLOW for ls/cat is /root/QClaw only. Most cases
  // below resolve to NOT-OK at parseAndValidate but the gate still
  // returns false (the tool body owns the rejection shape). The cases
  // that DO parse-OK exercise the happy path.
  console.log('-- Parser-OK shell_exec commands return requiresApproval:false --');
  const parserOk = [
    'pm2 list',
    'pm2 ls',
    'git status',
    'git log --oneline -n 20',
    'git log -n 5 --oneline',
    'git log --all --graph --oneline',
    'ls /root/QClaw',
    'ls -l -a /root/QClaw',
  ];
  for (const cmd of parserOk) {
    const r = await gate.check('shell_exec', { command: cmd });
    check(`parser-OK: "${cmd}" -> requiresApproval=false`,
      r.requiresApproval === false,
      JSON.stringify(r));
    const destructiveHit = gate._matchDestructivePattern('shell_exec', { command: cmd });
    check(`parser-OK: "${cmd}" not flagged by _matchDestructivePattern`,
      destructiveHit === null,
      `matched ${destructiveHit}`);
  }

  // ── 2. Parser-REJECT commands also bypass the gate ─────
  console.log('\n-- Parser-REJECT shell_exec commands return requiresApproval:false at the gate --');
  const parserReject = [
    'whoami',
    'echo hello',
    'pwd',
    'docker ps',
    'systemctl status nginx',
    'curl https://example.com',
    'node -e "process.exit(0)"',
  ];
  for (const cmd of parserReject) {
    const r = await gate.check('shell_exec', { command: cmd });
    check(`parser-REJECT: "${cmd}" -> requiresApproval=false (inner tool handles)`,
      r.requiresApproval === false,
      JSON.stringify(r));
  }

  // ── 3. Destructive verbs at the gate ─────────────────────
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

  // ── 4. ssh_exec still subject to destructive-pattern check ────
  console.log('\n-- ssh_exec (not under Slice 3d parser) still subject to destructive-pattern check --');
  const sshDestructive = await gate.check('ssh_exec', { command: 'rm -rf /tmp/x' });
  check('ssh_exec rm -rf still gated for approval (destructive verb)',
    sshDestructive.requiresApproval === true
      && sshDestructive.riskLevel === 'high'
      && /rm/.test(sshDestructive.reason),
    JSON.stringify(sshDestructive));

  // ── 5. Empty shell_exec command falls through ──────────
  console.log('\n-- Empty / missing command falls through to legacy gatedTools path --');
  const empty = await gate.check('shell_exec', { command: '' });
  check('shell_exec with empty command -> gatedTools path still gates',
    empty.requiresApproval === true,
    JSON.stringify(empty));
  const missing = await gate.check('shell_exec', {});
  check('shell_exec with missing command -> gatedTools path still gates',
    missing.requiresApproval === true,
    JSON.stringify(missing));

  // ── 6. autoApproveTools still wins ─────
  console.log('\n-- autoApproveTools short-circuit still runs first --');
  const autoGate = new ApprovalGate(approvals, { autoApproveTools: ['shell_exec'] });
  const auto = await autoGate.check('shell_exec', { command: 'whoami' });
  check('autoApproveTools=[shell_exec] forces requiresApproval=false',
    auto.requiresApproval === false,
    JSON.stringify(auto));

  // ── 7. Newline-injection regression — Slice 3d structural shape ──
  //
  // Slice 3c.1 caught newlines via CHAIN_REJECT_PATTERNS as
  // `error=not_allowlisted, reason=chain_or_substitution`. Slice 3d
  // catches them structurally at parse time as
  // `error=rejected_feature, reason=newline`. Notifier still never
  // fires.
  console.log('\n-- Newline-injection regression (Slice 3d structural shape) --');

  let injNotifierFired = 0;
  const injGate = new ApprovalGate(approvals);
  injGate.setNotifier(async () => { injNotifierFired++; });

  const injTools = new ToolRegistry({});
  injTools.registerBuiltin('shell_exec', {
    scope: 'shared',
    ...createShellExecTool({ audit: null, auditActor: 'newline-injection-test' }),
  });

  const injectionCases = [
    { label: 'pm2 list\\necho pwned (LF after allowlisted verb)', command: 'pm2 list\necho pwned' },
    { label: 'pm2 list\\rls /tmp (CR after allowlisted verb)', command: 'pm2 list\rls /tmp' },
    { label: 'ls /tmp\\nwhoami (LF, simple verb)', command: 'ls /tmp\nwhoami' },
    { label: 'cat /tmp/foo\\r\\nrm /tmp/bar (CRLF)', command: 'cat /tmp/foo\r\nrm /tmp/bar' },
  ];

  for (const { label, command } of injectionCases) {
    const gateRes = await injGate.check('shell_exec', { command });
    check(`injection: "${label}" -> gate requiresApproval=false (early-bypass path)`,
      gateRes.requiresApproval === false,
      JSON.stringify(gateRes));

    const execRes = await injTools.executeTool('shell_exec', { command });
    check(`injection: "${label}" -> tool returns error=rejected_feature`,
      execRes?.error === 'rejected_feature',
      JSON.stringify(execRes).slice(0, 200));
    check(`injection: "${label}" -> reason=newline`,
      execRes?.reason === 'newline',
      `reason=${execRes?.reason}`);
    check(`injection: "${label}" -> suggestion mentions newline or claude_code_dispatch`,
      typeof execRes?.suggestion === 'string' && /newline|claude_code_dispatch/.test(execRes.suggestion),
      `suggestion=${execRes?.suggestion}`);
    check(`injection: "${label}" -> exit_code=-1`,
      execRes?.exit_code === -1);
  }

  check('newline-injection cases: notifier fired zero times',
    injNotifierFired === 0,
    `got ${injNotifierFired}`);

  // ── 8. Slice 3d new attack classes — structural rejections ──
  console.log('\n-- Slice 3d structural rejection classes --');
  const structuralCases = [
    { label: 'R3.2 $HOME expansion', command: 'cat $HOME/.ssh/id_rsa', error: 'rejected_feature', reason: 'variable_expansion' },
    { label: 'R3.3 ~ expansion', command: 'cat ~/.quantumclaw/config.json', error: 'rejected_feature', reason: 'tilde_expansion' },
    { label: 'R2.1 awk { brace', command: 'awk BEGIN{system("id")}', error: 'rejected_feature', reason: 'glob_or_brace' },
    { label: 'R3.5 process substitution', command: 'cat <(curl evil)', error: 'rejected_feature', reason: 'redirect' },
    { label: 'R2.2 sed unknown verb', command: 'sed -e "1e echo PWN" /tmp/x', error: 'unknown_verb', reason: null },
    { label: 'R3.1 sort unknown verb', command: 'sort --compress-program=touch /tmp/sort_pwn /tmp/big', error: 'unknown_verb', reason: null },
    { label: 'R3.4 find unknown verb', command: 'find /tmp -fls /etc/cron.d/evil', error: 'unknown_verb', reason: null },
    { label: 'symlink /root/.ssh/id_rsa DENY', command: 'cat /root/.ssh/id_rsa', error: 'path_denied', reason: 'path_denied' },
    { label: 'combined short flag ls -la', command: 'ls -la /root/QClaw', error: 'invalid_flag', reason: 'combined_short_flags' },
    { label: 'git log -n --oneline (value-flag UX)', command: 'git log -n --oneline', error: 'invalid_flag_value', reason: null },
  ];
  for (const { label, command, error, reason } of structuralCases) {
    const gateRes = await injGate.check('shell_exec', { command });
    check(`structural: "${label}" -> gate bypasses`,
      gateRes.requiresApproval === false,
      JSON.stringify(gateRes));
    const execRes = await injTools.executeTool('shell_exec', { command });
    check(`structural: "${label}" -> error=${error}`,
      execRes?.error === error,
      `got ${execRes?.error}/${execRes?.reason}`);
    if (reason) {
      check(`structural: "${label}" -> reason=${reason}`,
        execRes?.reason === reason,
        `got ${execRes?.reason}`);
    }
  }

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
