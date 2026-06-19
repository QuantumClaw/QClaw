/**
 * Slice 6b Unit 3 — specialist gate verification harness.
 * Run: node scripts/verify-specialist-gate.js
 *
 * Adversarial check that the Gate 2 extension is additive and correct:
 *  1. delegate_to success event   → gateDelegation passes (no fire)
 *  2. no delegate_to event + claim → gateDelegation fires
 *  3. routed_back + "handling directly" → gate does NOT fire (no trigger word)
 *  4. CC dispatch event still backs a CC delegation claim (regression)
 * Exits non-zero if any assertion fails.
 */

import { AuditLog } from '../src/security/audit.js';
import { gateDelegation } from '../src/agents/gates.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let failures = 0;
function assert(label, cond) {
  if (cond) { console.log(`  PASS  ${label}`); }
  else { console.error(`  FAIL  ${label}`); failures++; }
}
function audit() { return new AuditLog({ _dir: mkdtempSync(join(tmpdir(), 'vsg-')) }); }
function ctx(a) { return { auditLog: a, now: Date.now(), turnStartMs: Date.now() - 5000, windowMinComplete: 10 }; }

// 1 — delegate_to success backs the claim
{
  const a = audit();
  a.log('tool', 'delegate_to', JSON.stringify({ id: 'c1', args: { specialist: 'content-studio-operator', task: 't' } }));
  a.log('tool', 'delegate_to', JSON.stringify({ id: 'c1', result: 'queued' }), { resultStatus: 'success' });
  assert('delegate_to event → gate passes', gateDelegation('I delegated this to content-studio-operator.', ctx(a)).fired === false);
}
// 2 — no evidence → fires
{
  assert('no delegate_to event + claim → gate fires',
    gateDelegation('I delegated this to content-studio-operator.', ctx(audit())).fired === true);
}
// 3 — stub routed-back, handling directly → no fire
{
  assert('routed_back + "handling directly" → gate does NOT fire',
    gateDelegation('content-studio-operator is a stub, so I am handling this directly.', ctx(audit())).fired === false);
}
// 4 — CC regression
{
  const a = audit();
  a.log('tool', 'claude_code_dispatch', JSON.stringify({ id: 'cc1', args: { task: 'audit task_abc123def456' } }));
  a.log('tool', 'claude_code_dispatch', JSON.stringify({ id: 'cc1', result: 'queued' }), { resultStatus: 'success' });
  assert('CC dispatch event still backs CC claim (regression)',
    gateDelegation('I dispatched task_abc123def456 to Claude Code.', ctx(a)).fired === false);
}

console.log(failures === 0 ? '\nALL SPECIALIST-GATE ASSERTIONS PASSED' : `\n${failures} ASSERTION(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
