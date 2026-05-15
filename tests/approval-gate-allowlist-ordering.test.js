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
 *   4. Newline-injection regression (Slice 3c.1 adversarial review):
 *      `pm2 list\necho pwned` style commands must be rejected with
 *      error=not_allowlisted (reason=chain_or_substitution,
 *      pattern=newline) when driven through the live executor
 *      sequence — real ApprovalGate, real ToolRegistry, real
 *      shell-exec via registerBuiltin. Notifier never fires.
 *   5. Round-2 adversarial findings (Slice 3c.1, 2026-05-15):
 *      awk shell-escape (BEGIN{system(...)}), sed shell-escape
 *      (`-e "1e ..."`), sed file-I/O (`r`/`w`/`R`/`W`), and
 *      path-traversal via `/tmp/../etc/...` redirect — all must be
 *      rejected through the same live executor path with
 *      error=not_allowlisted. Notifier never fires.
 *
 * Run: node tests/approval-gate-allowlist-ordering.test.js
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

  // ── 7. Newline-injection regression (Slice 3c.1 adversarial review) ──
  //
  // Pre-fix repro (2026-05-15 adversarial review): the post-3c.1 gate
  // ordering meant `shell_exec({command: "pm2 list\necho pwned"})` was
  // pre-approved by the new early branch in ApprovalGate.check() and
  // then executed verbatim under `execAsync(command, {shell:'/bin/bash'})`,
  // which treats `\n` like `;` — both lines ran as root with NO approval
  // prompt. CHAIN_REJECT_PATTERNS handled `;`, `&&`, `||`, `&`, `$(`,
  // backtick — but not `\n` or `\r`.
  //
  // Fix: add `{ name: 'newline', re: /[\r\n]/ }` to CHAIN_REJECT_PATTERNS.
  // Below we drive the same executor sequence the production
  // ToolExecutor.run() uses (approvalGate.check → tools.executeTool)
  // against real ApprovalGate + real ToolRegistry + real shell_exec, and
  // assert the injected newline / carriage-return commands are rejected
  // with error=not_allowlisted (reason=chain_or_substitution,
  // pattern=newline) and the notifier never fires.
  console.log('\n-- Newline-injection regression (Slice 3c.1 adversarial review) --');

  let injNotifierFired = 0;
  const injGate = new ApprovalGate(approvals);
  injGate.setNotifier(async () => { injNotifierFired++; });

  const injTools = new ToolRegistry({});
  injTools.registerBuiltin('shell_exec', {
    scope: 'shared',
    ...createShellExecTool({ approvalGate: injGate, audit: null, auditActor: 'newline-injection-test' }),
  });

  const injectionCases = [
    { label: 'pm2 list\\necho pwned (LF after allowlisted verb)', command: 'pm2 list\necho pwned' },
    { label: 'pm2 list\\rls /tmp (CR after allowlisted verb)', command: 'pm2 list\rls /tmp' },
    { label: 'ls /tmp\\nwhoami (LF, simple verb)', command: 'ls /tmp\nwhoami' },
    { label: 'cat /tmp/foo\\r\\nrm /tmp/bar (CRLF)', command: 'cat /tmp/foo\r\nrm /tmp/bar' },
  ];

  for (const { label, command } of injectionCases) {
    // Mirror the executor sequence: gate.check first, then executeTool.
    const gateRes = await injGate.check('shell_exec', { command });
    check(`injection: "${label}" -> gate requiresApproval=false (early-bypass path)`,
      gateRes.requiresApproval === false,
      JSON.stringify(gateRes));

    const execRes = await injTools.executeTool('shell_exec', { command });
    check(`injection: "${label}" -> tool returns error=not_allowlisted`,
      execRes?.error === 'not_allowlisted',
      JSON.stringify(execRes).slice(0, 200));
    check(`injection: "${label}" -> reason=chain_or_substitution`,
      execRes?.reason === 'chain_or_substitution',
      `reason=${execRes?.reason}`);
    check(`injection: "${label}" -> suggestion mentions newline`,
      typeof execRes?.suggestion === 'string' && /newline/.test(execRes.suggestion),
      `suggestion=${execRes?.suggestion}`);
    check(`injection: "${label}" -> exit_code=-1`,
      execRes?.exit_code === -1);
  }

  check('newline-injection cases: notifier fired zero times',
    injNotifierFired === 0,
    `got ${injNotifierFired}`);

  // ── 8. Round-2 adversarial findings (Slice 3c.1) ────────────
  //
  // Round 2 of adversarial review (2026-05-15) surfaced four
  // additional bypasses on top of the newline-injection finding:
  //
  //   CRITICAL #1 — awk shell-escape:
  //     `awk BEGIN{system("echo PWN")}` runs shell from inside awk's
  //     program body via the system() builtin. Variants include
  //     `awk -e BEGIN{system(...)}`, `awk 'BEGIN{print "x" | "sh"}'`,
  //     awk's `|&` coprocess operator. None are catchable by flag
  //     enumeration because the shell-spawn lives inside the program
  //     body (quoted), not in argv.
  //
  //   CRITICAL #2 — sed shell-escape via `e` command:
  //     `sed -e "1e echo PWN" /tmp/x` — GNU sed's `e` command
  //     executes the shell per pattern-matched line. Only `-i` /
  //     `--in-place` were in DISALLOWED_FLAGS pre-3c.1-round-2.
  //
  //   HIGH #1 — sed internal file I/O:
  //     `sed -e "1r /etc/shadow" /tmp/x` reads arbitrary files;
  //     `sed -e "w /etc/cron.d/evil" /tmp/x` writes to arbitrary
  //     files (bypasses shell-redirect DESTRUCTIVE regex via sed's
  //     internal `w` command); same surface: `R` / `W`.
  //
  //   HIGH #2 — path-traversal through redirect-outside-/tmp:
  //     `cat /tmp/x > /tmp/../etc/passwd` passes the DESTRUCTIVE
  //     regex `>\s*\/(?!dev/null|tmp/)` because it sees `> /tmp/`
  //     and exempts it. Bash then resolves `/tmp/../etc/passwd`
  //     to `/etc/passwd`. Mixed-dot variant `/tmp/./../etc/passwd`
  //     same bypass.
  //
  // Decision per Tyson: drop awk + sed from ALLOWED_VERBS rather
  // than chase enumerated flag/body bans (enumeration is
  // unsustainable — see Slice 3d planned redesign). Add `..`
  // path-traversal rejection at the allowlist layer.
  //
  // Below: each round-2 finding driven through the live executor
  // sequence (real ApprovalGate + real ToolRegistry + real
  // shell_exec via registerBuiltin). Notifier never fires.
  console.log('\n-- Round-2 adversarial findings (Slice 3c.1) --');

  let r2NotifierFired = 0;
  const r2Gate = new ApprovalGate(approvals);
  r2Gate.setNotifier(async () => { r2NotifierFired++; });

  const r2Tools = new ToolRegistry({});
  r2Tools.registerBuiltin('shell_exec', {
    scope: 'shared',
    ...createShellExecTool({ approvalGate: r2Gate, audit: null, auditActor: 'round2-adversarial-test' }),
  });

  // CRITICAL #1 — awk shell-escape: verb dropped → not_allowlisted.
  // CRITICAL #2 — sed shell-escape via `e`: verb dropped → not_allowlisted.
  // HIGH #1     — sed file I/O via r/w/R/W: verb dropped → not_allowlisted.
  // Each row: { label, command, expectReason }.
  //   - 'not_allowlisted' = checkSegment found the verb not in SINGLE_VERBS
  //     (the dropped-verb branch).
  //   - 'chain_or_substitution' = CHAIN_REJECT_PATTERNS caught the body
  //     first (e.g. `..` traversal). This is what the path-traversal
  //     cases below take. Both shapes return error=not_allowlisted at
  //     the tool layer because that's the single `not_allowlisted`
  //     response shape — `reason` differs.
  const r2Cases = [
    // CRITICAL #1 — awk variants
    { label: 'awk BEGIN{system("echo PWN")} (CRITICAL #1)',
      command: 'awk BEGIN{system("echo PWN")}',
      expectReason: 'not_allowlisted' },
    { label: 'awk -e BEGIN{system("id")} (CRITICAL #1 variant)',
      command: 'awk -e BEGIN{system("id")}',
      expectReason: 'not_allowlisted' },
    { label: 'awk \'BEGIN{print "x" | "sh"}\' (CRITICAL #1 pipe-to-shell variant)',
      command: 'awk \'BEGIN{print "x" | "sh"}\'',
      expectReason: 'not_allowlisted' },
    // CRITICAL #2 — sed `e` command
    { label: 'sed -e "1e echo PWN" /tmp/x (CRITICAL #2)',
      command: 'sed -e "1e echo PWN" /tmp/x',
      expectReason: 'not_allowlisted' },
    // HIGH #1 — sed file I/O
    { label: 'sed "1r /etc/shadow" /tmp/x (HIGH #1, sed `r` read)',
      command: 'sed "1r /etc/shadow" /tmp/x',
      expectReason: 'not_allowlisted' },
    { label: 'sed -e "w /etc/cron.d/evil" /tmp/x (HIGH #1, sed `w` write)',
      command: 'sed -e "w /etc/cron.d/evil" /tmp/x',
      expectReason: 'not_allowlisted' },
    // HIGH #2 — path-traversal through redirect-outside-/tmp.
    // Blocking mechanism: CHAIN_REJECT_PATTERNS catches `..` anywhere
    // in the command body (see comment in shell-exec-allowlist.js).
    // Returns error=not_allowlisted with reason=chain_or_substitution
    // and pattern=parent-dir traversal. The tool layer never reaches
    // the DESTRUCTIVE step. Conservative-but-clean: rejects all `..`
    // even for non-redirect uses; documented in commit message.
    { label: 'cat /tmp/x > /tmp/../etc/passwd (HIGH #2, /tmp/.. traversal)',
      command: 'cat /tmp/x > /tmp/../etc/passwd',
      expectReason: 'chain_or_substitution' },
    { label: 'cat /tmp/x > /tmp/./../etc/passwd (HIGH #2, mixed-dot traversal)',
      command: 'cat /tmp/x > /tmp/./../etc/passwd',
      expectReason: 'chain_or_substitution' },
  ];

  for (const { label, command, expectReason } of r2Cases) {
    // Mirror executor sequence: gate.check, then executeTool.
    const gateRes = await r2Gate.check('shell_exec', { command });
    check(`round-2: "${label}" -> gate requiresApproval=false (early-bypass path)`,
      gateRes.requiresApproval === false,
      JSON.stringify(gateRes));

    const execRes = await r2Tools.executeTool('shell_exec', { command });
    check(`round-2: "${label}" -> tool returns error=not_allowlisted`,
      execRes?.error === 'not_allowlisted',
      JSON.stringify(execRes).slice(0, 200));
    check(`round-2: "${label}" -> reason=${expectReason}`,
      execRes?.reason === expectReason,
      `got reason=${execRes?.reason}`);
    check(`round-2: "${label}" -> exit_code=-1`,
      execRes?.exit_code === -1);
    check(`round-2: "${label}" -> response carries suggestion`,
      typeof execRes?.suggestion === 'string' && execRes.suggestion.length > 0);
  }

  check('round-2 cases: notifier fired zero times',
    r2NotifierFired === 0,
    `got ${r2NotifierFired}`);

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
