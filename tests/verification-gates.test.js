/**
 * Slice 4 Unit 1 — substrate + framework + Gate 4 tests.
 * Run: node tests/verification-gates.test.js
 *
 * Covers: audit.js ISO-UTC timestamp + parseAuditTs (legacy + ISO) +
 * result_status capture + toolEventsSince time-window; gates.js detection
 * (sentence split, code-span strip, suppression), entity extraction +
 * correlatePairs + matchEvidence (entity backs / unrelated same-tool success
 * does NOT / no-entity fallback), Gate 4 (phantom caught, real passes,
 * code-fenced not flagged), runGates (kill-switch, fail-closed on throw);
 * gate-log unanchored scrub + shape.
 * Design ref: /tmp/slice4_design.md §1, §2, §2.5, §3, §8.
 */

import { AuditLog, parseAuditTs } from '../src/security/audit.js';
import {
  splitSentences, stripCodeSpans, isSuppressed, extractEntities, correlatePairs,
  matchEvidence, gateToolReference, runGates,
} from '../src/agents/gates.js';
import { appendGateLog } from '../src/observability/gate-log.js';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label} ${detail}`); failed++; }
}
const dir = mkdtempSync(join(tmpdir(), 'gates-'));

console.log('audit.js substrate:');
const audit = new AuditLog({ _dir: dir });
audit.log('tool', 'deploy', '{"id":"Qf39NEOEgz2W0uls"}');               // call row
audit.log('tool', 'deploy', 'Workflow updated', { resultStatus: 'success' }); // result row
audit.log('tool', 'probe', '{"x":1}', { resultStatus: 'error' });
const recent = audit.recent(10);
check('timestamp stored as ISO (has T)', recent[0].timestamp.includes('T'));
check('result_status captured (success)', recent.some(r => r.action === 'deploy' && r.result_status === 'success'));
check('result_status captured (error)', recent.some(r => r.action === 'probe' && r.result_status === 'error'));
check('call row has null result_status', recent.some(r => r.action === 'deploy' && r.result_status == null));
check('parseAuditTs ISO', parseAuditTs('2026-06-04T08:42:32.000Z') === Date.parse('2026-06-04T08:42:32.000Z'));
check('parseAuditTs legacy space-format → UTC', parseAuditTs('2026-06-04 08:42:32') === Date.parse('2026-06-04T08:42:32Z'));
check('parseAuditTs junk → NaN', Number.isNaN(parseAuditTs('not a date')));
check('toolEventsSince includes recent', audit.toolEventsSince(new Date(Date.now() - 60000).toISOString()).length >= 3);
check('toolEventsSince excludes future cutoff', audit.toolEventsSince(new Date(Date.now() + 60000).toISOString()).length === 0);

console.log('detection helpers:');
check('splitSentences splits on . and newline', splitSentences('Done. It works.\nNext thing').length === 3);
check('stripCodeSpans removes fenced', !stripCodeSpans('text ```charlie__nope__x``` more').includes('nope'));
check('stripCodeSpans removes inline code', !stripCodeSpans('use `charlie__nope__x` now').includes('nope'));
check('suppressed: interrogative ?', isSuppressed('is it working?') === true);
check('suppressed: interrogative open', isSuppressed('Did I deploy it') === true);
check('suppressed: negation', isSuppressed('this is not done') === true);
check('suppressed: future', isSuppressed("I'll deploy it now") === true);
check('suppressed: once-conditional', isSuppressed('once X is deployed we ship') === true);
check('suppressed: quoted', isSuppressed('"it is done"') === true);
check('NOT suppressed: plain assertion', isSuppressed('the workflow is deployed') === false);

console.log('entity + evidence matching:');
check('extractEntities long id', extractEntities('deployed Qf39NEOEgz2W0uls now').includes('Qf39NEOEgz2W0uls'));
check('extractEntities file path', extractEntities('fixed /root/QClaw/src/x.js').some(e => e.includes('x.js')));
check('extractEntities none in vague', extractEntities('it is done').filter(e => e.length >= 12).length === 0);
// id-DESC events (result row higher id → precedes call row); detail embeds the call id.
const evNow = new Date().toISOString();
const events = [
  { action: 'deploy', detail: '{"id":"toolu_1","result":"Workflow updated"}', result_status: 'success', timestamp: evNow },
  { action: 'deploy', detail: '{"id":"toolu_1","args":{"id":"Qf39NEOEgz2W0uls"}}', result_status: null, timestamp: evNow },
];
check('correlatePairs pairs result+call by id', correlatePairs(events).length === 1);
check('matchEvidence: entity in call args → backed', matchEvidence('deployed Qf39NEOEgz2W0uls', events, { requireStatus: 'success' }).backed === true);
check('matchEvidence: UNRELATED entity, same tool success → NOT backed', matchEvidence('deployed WkXX0000zz9988yy', events, { requireStatus: 'success' }).backed === false);
check('matchEvidence: error-only row → not backed for success', matchEvidence('deployed Qf39NEOEgz2W0uls', [
  { action: 'deploy', detail: '{"id":"toolu_2","result":"boom"}', result_status: 'error', timestamp: evNow },
  { action: 'deploy', detail: '{"id":"toolu_2","args":{"id":"Qf39NEOEgz2W0uls"}}', result_status: null, timestamp: evNow },
], { requireStatus: 'success' }).backed === false);
check('matchEvidence: no-entity this-turn fallback → backed weak', (() => {
  const r = matchEvidence('it is done', events, { requireStatus: 'success', turnStartMs: Date.now() - 120000 });
  return r.backed === true && r.weak === true;
})());
check('matchEvidence: no-entity, evidence pre-dates turn → not backed', matchEvidence('it is done', events, { requireStatus: 'success', turnStartMs: Date.now() + 60000 }).backed === false);
// P1-2: interleaved cross-agent rows — id correlation must pair correctly (errored claim not success-backed)
const interleaved = [
  { action: 'deploy', detail: '{"id":"BB","result":"boom"}', result_status: 'error', timestamp: evNow },
  { action: 'deploy', detail: '{"id":"AA","result":"ok"}', result_status: 'success', timestamp: evNow },
  { action: 'deploy', detail: '{"id":"BB","args":{"id":"WorkflowBB990000"}}', result_status: null, timestamp: evNow },
  { action: 'deploy', detail: '{"id":"AA","args":{"id":"WorkflowAA110000"}}', result_status: null, timestamp: evNow },
];
check('interleaved: errored BB claim NOT success-backed', matchEvidence('deployed WorkflowBB990000', interleaved, { requireStatus: 'success' }).backed === false);
check('interleaved: AA success claim backed', matchEvidence('deployed WorkflowAA110000', interleaved, { requireStatus: 'success' }).backed === true);
// P2: common English word must NOT be treated as an entity that spuriously backs a claim
const cfgEvents = [
  { action: 'set_config', detail: '{"id":"C1","result":"configuration saved"}', result_status: 'success', timestamp: evNow },
  { action: 'set_config', detail: '{"id":"C1","args":{"configuration":"x"}}', result_status: null, timestamp: evNow },
];
check('common word "configuration" not a spurious entity', matchEvidence('the configuration is fixed', cfgEvents, { requireStatus: 'success', turnStartMs: Date.now() + 60000 }).backed === false);

console.log('Gate 4 (tool reference):');
const reg = { has: (n) => ['charlie__ghl__get_contacts', 'web_fetch'].includes(n) };
check('phantom tool → fired hard', (() => { const g = gateToolReference('I used charlie__nope__doit to fix it', { toolRegistry: reg }); return g.fired && g.severity === 'hard'; })());
check('real tool → not fired', gateToolReference('I used charlie__ghl__get_contacts', { toolRegistry: reg }).fired === false);
check('phantom in code fence → NOT flagged (Gate 4 strips code)', gateToolReference('example: ```charlie__nope__doit```', { toolRegistry: reg }).fired === false);

console.log('runGates framework:');
check('kill-switch QCLAW_GATES_ENABLED=0 → pass+disabled', (() => {
  process.env.QCLAW_GATES_ENABLED = '0';
  const r = runGates('I used charlie__nope__doit', audit, reg, {});
  delete process.env.QCLAW_GATES_ENABLED;
  return r.result === 'pass' && r.disabled === true;
})());
check('enabled: phantom → hard_fail', runGates('used charlie__nope__doit', audit, reg, {}).result === 'hard_fail');
check('clean response → pass', runGates('all good, nothing to verify here', audit, reg, {}).result === 'pass');
check('fail-closed: throwing registry → hard_fail (no throw out)', (() => {
  const badReg = { has: () => { throw new Error('boom'); } };
  const r = runGates('used charlie__x__y', audit, badReg, {});
  return r.result === 'hard_fail';
})());

console.log('Gate 1 / 3 / 2 (Unit 2):');
import { gateCompletion, gateState, gateDelegation } from '../src/agents/gates.js';
const ts2 = new Date().toISOString();
const mkAudit = (events) => ({ toolEventsSince: () => events });
const ctx = (events, extra = {}) => ({ auditLog: mkAudit(events), now: Date.now(), turnStartMs: Date.now() - 60000, windowMinComplete: 10, windowMinState: 5, ...extra });
const successPair = (action, entity) => ([
  { action, detail: `{"id":"p1","result":"OK updated"}`, result_status: 'success', timestamp: ts2 },
  { action, detail: `{"id":"p1","args":{"id":"${entity}"}}`, result_status: null, timestamp: ts2 },
]);
const errorPair = (action, entity) => ([
  { action, detail: `{"id":"p2","result":"boom"}`, result_status: 'error', timestamp: ts2 },
  { action, detail: `{"id":"p2","args":{"id":"${entity}"}}`, result_status: null, timestamp: ts2 },
]);

// Gate 1 — completion
check('G1: completion backed by matching success → not fired',
  gateCompletion('Deployed workflow Qf39NEOEgz2W0uls.', ctx(successPair('n8n_workflow_update', 'Qf39NEOEgz2W0uls'))).fired === false);
check('G1: completion, entity has NO backing → hard_fail',
  (() => { const g = gateCompletion('Deployed workflow Zz000000zz11.', ctx(successPair('n8n_workflow_update', 'Qf39NEOEgz2W0uls'))); return g.fired && g.severity === 'hard'; })());
check('G1: completion entity backed only by ERROR row → hard_fail',
  gateCompletion('Deployed workflow Qf39NEOEgz2W0uls.', ctx(errorPair('n8n_workflow_update', 'Qf39NEOEgz2W0uls'))).fired === true);
check('G1: future "I\'ll deploy" suppressed → not fired',
  gateCompletion("I'll deploy workflow Qf39NEOEgz2W0uls next.", ctx([])).fired === false);

// Gate 3 — state
check('G3: "running" with probe that RAN → not fired',
  gateState('The workflow Qf39NEOEgz2W0uls is running.', ctx(successPair('shared__n8n-api__n8n-api__get_workflows_id', 'Qf39NEOEgz2W0uls'))).fired === false);
check('G3: "running" with NO probe → soft_fail',
  (() => { const g = gateState('The workflow Qf39NEOEgz2W0uls is running.', ctx([])); return g.fired && g.severity === 'soft'; })());
check('G3: characterization "healthy" but probe ERRORED → hard_fail',
  (() => { const g = gateState('The workflow Qf39NEOEgz2W0uls is healthy.', ctx(errorPair('shared__n8n-api__n8n-api__get_workflows_id', 'Qf39NEOEgz2W0uls'))); return g.fired && g.severity === 'hard'; })());

// Gate 2 — delegation (tense-discriminated, fail-closed)
check('G2: past "I dispatched ... to Claude Code" → hard fail-closed',
  (() => { const g = gateDelegation('I dispatched the audit to Claude Code.', ctx([])); return g.fired && g.severity === 'hard' && g.action === 'fail_closed_slice5_pending'; })());
check('G2: future "I\'ll dispatch" (plan) → not fired',
  gateDelegation("I'll dispatch the audit to Claude Code.", ctx([])).fired === false);

// Unit-2 review fixes:
// P1-a: elided-subject declarative "Is working on it" must NOT be suppressed (fires Gate 2)
check('R(P1a): "Is working on it." NOT suppressed (declarative)', isSuppressed('Is working on it.') === false);
check('R(P1a): true question "is it working?" still suppressed', isSuppressed('is it working?') === true);
check('R(P1a): "is the workflow running?" still suppressed', isSuppressed('is the workflow running?') === true);
check('R(P1a): standalone "Is working on it." fires Gate 2', gateDelegation('Is working on it.', ctx([])).fired === true);
// P1-b: liveness "running" backed by an ERRORED probe → hard_fail (was a false-pass)
check('R(P1b): "running" + errored probe → hard_fail', (() => { const g = gateState('The workflow Qf39NEOEgz2W0uls is running.', ctx(errorPair('shared__n8n-api__n8n-api__get_workflows_id', 'Qf39NEOEgz2W0uls'))); return g.fired && g.severity === 'hard'; })());
// P1-c: entity-bearing success that PRE-DATES the turn must not back the claim
check('R(P1c): pre-turn entity success → NOT backed', matchEvidence('deployed Qf39NEOEgz2W0uls', events, { requireStatus: 'success', turnStartMs: Date.now() + 60000 }).backed === false);

// runGates integration: phantom tool + unbacked completion → hard_fail
check('runGates: phantom + unbacked completion → hard_fail',
  runGates('Used charlie__nope__doit and deployed workflow Zz000000zz11.', mkAudit([]), reg, { now: Date.now(), turnStartMs: Date.now() - 60000 }).result === 'hard_fail');
check('runGates: clean factual w/ backing → pass',
  runGates('The workflow Qf39NEOEgz2W0uls is running.', mkAudit(successPair('shared__n8n-api__n8n-api__get_workflows_id', 'Qf39NEOEgz2W0uls')), reg, { now: Date.now(), turnStartMs: Date.now() - 60000 }).result === 'pass');

console.log('Unit 3 — regeneration loop:');
import { regenerateWithGates, isGatedAgent } from '../src/agents/gates.js';
// P0 scoping: gates apply to charlie only by default; background agents skip them.
check('U3: isGatedAgent("charlie") default true', isGatedAgent('charlie') === true);
check('U3: isGatedAgent("echo") default false (background agent skips gates)', isGatedAgent('echo') === false);
check('U3: QCLAW_GATES_AGENTS override', (() => { process.env.QCLAW_GATES_AGENTS = 'charlie,echo'; const r = isGatedAgent('echo'); delete process.env.QCLAW_GATES_AGENTS; return r === true; })());
const BM = [{ role: 'user', content: 'go' }];
const past = Date.now() - 5000;

// (1) seeded false completion, no backing → escalates after 3 attempts; raw claim never returned as truth
let n1 = 0;
const r1 = await regenerateWithGates({
  generate: async () => { n1++; return { content: 'Deployed workflow Zz000000zz11 successfully.', model: 'm' }; },
  auditLog: mkAudit([]), toolRegistry: reg, turnStart: past, baseMessages: BM,
});
check('U3: unbacked completion → 3 generate attempts', n1 === 3);
check('U3: → escalated (not pass)', r1.gateEscalated === true && r1.gateOutcome === 'hard_fail');
check('U3: escalation reframes (not asserted as done)', r1.content.includes("couldn't verify") && !/^Deployed workflow Zz000000zz11 successfully\.$/.test(r1.content.trim()));

// (2) DONE-BUT-ERRORED — claim completion after the tool returned result_status:error → hard_fail
let n2 = 0;
const r2 = await regenerateWithGates({
  generate: async () => { n2++; return { content: 'Deployed workflow Qf39NEOEgz2W0uls.', model: 'm' }; },
  auditLog: mkAudit(errorPair('n8n_workflow_update', 'Qf39NEOEgz2W0uls')), toolRegistry: reg, turnStart: past, baseMessages: BM,
});
check('U3: done-but-errored → hard_fail + escalated', r2.gateOutcome === 'hard_fail' && r2.gateEscalated === true && n2 === 3);

// (3) cleanupTools stays valid across ALL 3 attempts (layered call-site that bit 3b/3c) — DEMONSTRATED
let registered = true; const cleanup = () => { registered = false; }; const seenRegistered = [];
try {
  await regenerateWithGates({
    generate: async () => { seenRegistered.push(registered); return { content: 'Deployed workflow Zz000000zz11 now.', model: 'm' }; },
    auditLog: mkAudit([]), toolRegistry: reg, turnStart: past, baseMessages: BM,
  });
} finally { cleanup(); }
check('U3: tools registered on all 3 attempts (not torn down mid-loop)', seenRegistered.length === 3 && seenRegistered.every(x => x === true));
check('U3: cleanupTools fires exactly once AFTER the loop', registered === false);

// (4) soft_fail (state, no probe) → deterministic hedge, NO LLM regen, resolves to pass
let n4 = 0;
const r4 = await regenerateWithGates({
  generate: async () => { n4++; return { content: 'The workflow Qf39NEOEgz2W0uls is running.', model: 'm' }; },
  auditLog: mkAudit([]), toolRegistry: reg, turnStart: past, baseMessages: BM,
});
check('U3: soft_fail hedged without a second generate call', n4 === 1 && r4.content.includes('Unverified') && r4.gateOutcome === 'pass');

// (5) clean backed claim → pass on first attempt, content untouched
const r5 = await regenerateWithGates({
  generate: async () => ({ content: 'The workflow Qf39NEOEgz2W0uls is running.', model: 'm' }),
  auditLog: mkAudit(successPair('shared__n8n-api__n8n-api__get_workflows_id', 'Qf39NEOEgz2W0uls')), toolRegistry: reg, turnStart: past, baseMessages: BM,
});
check('U3: backed claim → pass attempt 1, content unchanged', r5.gateOutcome === 'pass' && r5.gateAttempts === 1 && r5.content === 'The workflow Qf39NEOEgz2W0uls is running.');

// (6) hard_fail then model self-corrects on re-prompt → pass, not escalated
let n6 = 0;
const r6 = await regenerateWithGates({
  generate: async () => { n6++; return n6 === 1 ? { content: 'Deployed workflow Zz000000zz11.', model: 'm' } : { content: "I have not verified that yet; let me check.", model: 'm' }; },
  auditLog: mkAudit([]), toolRegistry: reg, turnStart: past, baseMessages: BM,
});
check('U3: hard_fail then corrected re-prompt → pass, not escalated', r6.gateOutcome === 'pass' && n6 === 2 && !r6.gateEscalated);

console.log('gate-log:');
process.env.QCLAW_GATE_LOG_PATH = join(dir, 'gate.log');
appendGateLog({ gate: 'completion', claim: 'done; key sk-ant-admin01-SECRET123 here', result: 'hard_fail', action: 'reprompt', attempt: 1, verified: false });
const gl = readFileSync(join(dir, 'gate.log'), 'utf-8').trim();
const glRow = JSON.parse(gl);
check('gate.log JSONL shape', glRow.gate === 'completion' && glRow.result === 'hard_fail' && glRow.attempt === 1);
check('gate.log scrubs mid-string sk-ant key', !gl.includes('SECRET123') && gl.includes('<scrubbed>'));
check('gate.log mode 0600', (statSync(join(dir, 'gate.log')).mode & 0o777) === 0o600);
delete process.env.QCLAW_GATE_LOG_PATH;

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
