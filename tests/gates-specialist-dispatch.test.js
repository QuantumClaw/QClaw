/**
 * Slice 6b Unit 3 — Gate 2 specialist-dispatch extension tests.
 * Run: node tests/gates-specialist-dispatch.test.js
 *
 * Covers: specialist evidence predicates (action-name shape, A1-1 corrected),
 * gateDelegation passes with a delegate_to event, fires without evidence,
 * stub routed-back "handling directly" does NOT match DELEGATION_RE, and the
 * existing Claude Code path still backs CC claims (regression).
 */

import { AuditLog } from '../src/security/audit.js';
import { gateDelegation, __testing } from '../src/agents/gates.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let passed = 0, failed = 0;
const check = (l, c, d = '') => { if (c) { console.log(`  ✓ ${l}`); passed++; } else { console.error(`  ✗ ${l} ${d}`); failed++; } };

const { isSpecialistDispatch, isSpecialistResult, isAnyDispatch, isAnyResult } = __testing;

function freshAudit() {
  const dir = mkdtempSync(join(tmpdir(), 'gates6b-'));
  return { audit: new AuditLog({ _dir: dir }), dir };
}
function logCall(audit, action, id, args) {
  audit.log('tool', action, JSON.stringify({ id, args }));
}
function logResult(audit, action, id, result, ok = true) {
  audit.log('tool', action, JSON.stringify({ id, result }), { resultStatus: ok ? 'success' : 'error' });
}
function ctxFor(audit, turnStart) {
  return { auditLog: audit, now: Date.now(), turnStartMs: turnStart, windowMinComplete: 10 };
}

console.log('evidence predicates (A1-1 corrected: action-name strings):');
check('isSpecialistDispatch("delegate_to") true', isSpecialistDispatch('delegate_to') === true);
check('isSpecialistDispatch("claude_code_dispatch") false', isSpecialistDispatch('claude_code_dispatch') === false);
check('isSpecialistResult("delegate_to_result") true', isSpecialistResult('delegate_to_result') === true);
check('isSpecialistResult("delegate_to") false', isSpecialistResult('delegate_to') === false);
check('isAnyDispatch unions CC + specialist', isAnyDispatch('claude_code_dispatch') && isAnyDispatch('delegate_to') && !isAnyDispatch('shell_exec'));
check('isAnyResult unions CC + specialist', isAnyResult('claude_code_result') && isAnyResult('delegate_to_result') && !isAnyResult('delegate_to'));

console.log('gateDelegation PASSES with a delegate_to event backing the claim:');
{
  const { audit, dir } = freshAudit();
  const turnStart = Date.now() - 5000;
  logCall(audit, 'delegate_to', 'c1', { specialist: 'content-studio-operator', task: 'process episode 12' });
  logResult(audit, 'delegate_to', 'c1', '{"status":"queued"}');
  const out = gateDelegation('I delegated the podcast pipeline to content-studio-operator.', ctxFor(audit, turnStart));
  check('does not fire (backed by specialist dispatch)', out.fired === false, JSON.stringify(out));
  rmSync(dir, { recursive: true, force: true });
}

console.log('gateDelegation FIRES on a delegation claim with NO evidence:');
{
  const { audit, dir } = freshAudit();
  const out = gateDelegation('I delegated the security audit to content-studio-operator.', ctxFor(audit, Date.now() - 5000));
  check('fires (no delegate_to event)', out.fired === true && out.severity === 'hard');
  rmSync(dir, { recursive: true, force: true });
}

console.log('stub routed_back: "handling directly" does NOT trip Gate 2:');
{
  const { audit, dir } = freshAudit();
  const out = gateDelegation(
    'The content-studio-operator specialist is a scaffolded stub, so I am handling this directly.',
    ctxFor(audit, Date.now() - 5000));
  check('does not fire (no DELEGATION_RE trigger word)', out.fired === false, JSON.stringify(out));
  rmSync(dir, { recursive: true, force: true });
}

console.log('regression — Claude Code dispatch event still backs a CC claim:');
{
  const { audit, dir } = freshAudit();
  const turnStart = Date.now() - 5000;
  logCall(audit, 'claude_code_dispatch', 'cc1', { task: 'audit slice6 task_abc123def456' });
  logResult(audit, 'claude_code_dispatch', 'cc1', '{"status":"queued"}');
  const out = gateDelegation('I dispatched task_abc123def456 to Claude Code for an audit.', ctxFor(audit, turnStart));
  check('CC dispatch claim still backed', out.fired === false, JSON.stringify(out));
  rmSync(dir, { recursive: true, force: true });
}

console.log('regression — unrelated tool does NOT back a delegation claim:');
{
  const { audit, dir } = freshAudit();
  const turnStart = Date.now() - 5000;
  logCall(audit, 'shell_exec', 's1', { command: 'ls content-studio-operator' });
  logResult(audit, 'shell_exec', 's1', 'ok');
  const out = gateDelegation('I delegated the work to content-studio-operator.', ctxFor(audit, turnStart));
  check('still fires (shell_exec is not a dispatch tool)', out.fired === true, JSON.stringify(out));
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
