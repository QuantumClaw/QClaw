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

console.log('Slice 4.1 — bootstrap-as-evidence + recitation scoping:');
import { isFirstPersonAction, isGatedTurn, bootstrapCorpus, buildRepromptNote } from '../src/agents/gates.js';
// This-session bootstrap snapshot Charlie recites at session start: incident-log
// path + workflow id + PM2 process names + business-state numbers. Reproduces
// the 2026-06-04 shape (gate.log: completion "incident ... RESOLVED", state
// "... all stable at 38h", "9 paid subs").
const bootstrap4Jun = {
  state: {
    flow_os_state: '9 Flow OS paid subs (~$1.5k MRR); 10 active FSC engagements (~$4.5k MRR).',
    recent_build_log: 'closes 2026-06-03 needrestart pm2-root blacklist incident; /etc/needrestart/needrestart.conf updated. sunset workflow TikJkWLzpreI6iTa.',
  },
  probes: [{ name: 'pm2', ok: true, detail: 'agex-hub, trading-worker, clipper-worker, charlie-watcher all up 38h' }],
};
const bootText = bootstrapCorpus(bootstrap4Jun);
const turnAgo = Date.now() - 60000;

// first-person / elided action discriminator
check('4.1: "I deployed X" → first-person action', isFirstPersonAction('I deployed the needrestart fix.') === true);
check('4.1: "Deployed X." (elided subject) → first-person action', isFirstPersonAction('Deployed workflow TikJkWLzpreI6iTa.') === true);
check('4.1: "I\'ve shipped it" → first-person action', isFirstPersonAction("I've shipped it.") === true);
check('4.1: recited "The incident log shows X RESOLVED" → NOT first-person action',
  isFirstPersonAction('The incident log shows the 2026-06-03 outage is now RESOLVED via /etc/needrestart/needrestart.conf.') === false);
check('4.1: "I referenced a fix deployed" → NOT action (referenced is not an action verb)',
  isFirstPersonAction('I referenced a "fix deployed" without a tool result.') === false);

// bootstrap backs a RECITED claim about a known entity (no this-turn tool)
check('4.1: recited completion, entity IN bootstrap → backed (sourced bootstrap)', (() => {
  const m = matchEvidence('The incident log shows the outage is now RESOLVED via /etc/needrestart/needrestart.conf.', [], { requireStatus: 'success', turnStartMs: turnAgo, bootstrapText: bootText });
  return m.backed === true && m.sourced === 'bootstrap';
})());
// ADVERSARIAL (the constraint): first-person/elided action about the SAME known entity → NOT backed
check('4.1 ADVERSARIAL: "I deployed <bootstrap entity>" → NOT backed by bootstrap',
  matchEvidence('I deployed /etc/needrestart/needrestart.conf this session.', [], { requireStatus: 'success', turnStartMs: turnAgo, bootstrapText: bootText }).backed === false);
check('4.1 ADVERSARIAL: "Deployed workflow TikJkWLzpreI6iTa." (elided, in bootstrap) → NOT backed',
  matchEvidence('Deployed workflow TikJkWLzpreI6iTa.', [], { requireStatus: 'success', turnStartMs: turnAgo, bootstrapText: bootText }).backed === false);
// entity NOT in bootstrap and no tool → still strict
check('4.1: recited completion, entity NOT in bootstrap → not backed',
  matchEvidence('The log shows workflow Zz000000zz11 is now RESOLVED.', [], { requireStatus: 'success', turnStartMs: turnAgo, bootstrapText: bootText }).backed === false);

// ── 4.1 adversarial reconcile: action assertions that EVADE isFirstPersonAction
// (passive / impersonal / auxiliary-elided / nominalised) must still NOT be
// bootstrap-backed. Default-deny via bootstrapMayBack. Each names a known
// bootstrap entity (/etc/needrestart/needrestart.conf or TikJkWLzpreI6iTa).
import { bootstrapMayBack, corpusHasEntity } from '../src/agents/gates.js';
const NOT_BACKED = (s) => matchEvidence(s, [], { requireStatus: 'success', turnStartMs: turnAgo, bootstrapText: bootText }).backed === false;
check('4.1 ADV passive: "...needrestart.conf has been deployed" → NOT backed',
  NOT_BACKED('The change /etc/needrestart/needrestart.conf has been deployed successfully.'));
check('4.1 ADV passive copular: "TikJkWLzpreI6iTa is deployed" → NOT backed',
  NOT_BACKED('Workflow TikJkWLzpreI6iTa is deployed and the fix is complete.'));
check('4.1 ADV auxiliary-elided: "Have deployed TikJkWLzpreI6iTa" → NOT backed',
  NOT_BACKED('Have deployed TikJkWLzpreI6iTa, all done.'));
check('4.1 ADV got-form: "Got TikJkWLzpreI6iTa deployed" → NOT backed',
  NOT_BACKED('Got TikJkWLzpreI6iTa deployed and shipped.'));
check('4.1 ADV nominalised: "The deploy of TikJkWLzpreI6iTa is complete" → NOT backed',
  NOT_BACKED('The deploy of TikJkWLzpreI6iTa is complete.'));
check('4.1 ADV third-person subject: "Charlie deployed TikJkWLzpreI6iTa" → NOT backed',
  NOT_BACKED('Charlie deployed TikJkWLzpreI6iTa this session.'));
check('4.1 ADV off-list verb + completion kw: "I migrated …; deploy finished" → NOT backed',
  NOT_BACKED('I migrated /etc/needrestart/needrestart.conf; deploy finished.'));
// numeric substring-collision: bare digit-run entity inside a larger id/number must NOT back
const numColl = bootstrapCorpus({ probes: [{ name: 'n8n', detail: 'last execution 8842217 at 1749590610' }] });
check('4.1 ADV numeric collision: "Run 884221 is complete" (digit-substring of 8842217) → NOT backed',
  matchEvidence('Run 884221 is complete.', [], { requireStatus: 'success', turnStartMs: turnAgo, bootstrapText: numColl }).backed === false);
check('4.1 corpusHasEntity: boundary-aware (884221 is substring of 8842217, NOT a token) → false', corpusHasEntity(numColl, '884221') === false);
check('4.1 corpusHasEntity: whole-token match (8842217 standalone in corpus) → true', corpusHasEntity(numColl, '8842217') === true);
check('4.1 corpusHasEntity: digit-run inside larger number (959061 in 1749590610) → false', corpusHasEntity(numColl, '959061') === false);
// the must-BACK recitations still pass under default-deny
check('4.1 bootstrapMayBack: attributed completion recitation → true',
  bootstrapMayBack('The incident log shows the outage is now RESOLVED via /etc/needrestart/needrestart.conf.') === true);
check('4.1 bootstrapMayBack: pure state (no action verb) → true',
  bootstrapMayBack('agex-hub, trading-worker, clipper-worker all stable at 38h uptime.') === true);
check('4.1 bootstrapMayBack: unattributed passive action → false',
  bootstrapMayBack('TikJkWLzpreI6iTa has been deployed.') === false);
check('4.1 bootstrapMayBack: attributed but first-person ("the log shows I deployed X") → false (FP wins)',
  bootstrapMayBack('The build log shows I deployed TikJkWLzpreI6iTa.') === false);

// gate-level: recited incident completion passes; first-person action still hard_fails
check('4.1: gateCompletion recited incident (bootstrap) → not fired',
  gateCompletion('The incident log shows the 2026-06-03 outage is now RESOLVED with the blacklist added to /etc/needrestart/needrestart.conf.', ctx([], { bootstrapText: bootText })).fired === false);
check('4.1 ADVERSARIAL: gateCompletion "I deployed <known entity>" → hard_fail (Gate 1 alive)',
  (() => { const g = gateCompletion('I deployed /etc/needrestart/needrestart.conf this session.', ctx([], { bootstrapText: bootText })); return g.fired && g.severity === 'hard'; })());
check('4.1: gateState recited "... all stable at 38h" (process names in bootstrap) → not fired',
  gateState('agex-hub, trading-worker, clipper-worker, charlie-watcher all stable at 38h uptime.', ctx([], { bootstrapText: bootText })).fired === false);
// bootstrap must NOT mask a this-turn errored probe (characterization contradiction stays hard)
check('4.1: char "healthy" + this-turn ERRORED probe → still hard (bootstrap not a mask)',
  (() => { const g = gateState('The workflow Qf39NEOEgz2W0uls is healthy.', ctx(errorPair('shared__n8n-api__n8n-api__get_workflows_id', 'Qf39NEOEgz2W0uls'), { bootstrapText: bootstrapCorpus({ probes: [{ name: 'x', detail: 'Qf39NEOEgz2W0uls' }] }) })); return g.fired && g.severity === 'hard'; })());

// V3: reprompt note describes the violation, never echoes the claim text
const reproNote = buildRepromptNote({ gates: [{ gate: 'completion', fired: true, severity: 'hard', claims: [{ text: 'Deployed the fix deployed thing to prod' }] }] });
check('4.1 V3: reprompt note does NOT echo the failing claim text', !reproNote.includes('fix deployed thing') && !reproNote.includes('Deployed the'));
check('4.1 V3: reprompt note describes the completion violation by class', reproNote.includes('completion/action claim'));

// V4: background turns (heartbeat/digest) are not gated; interactive charlie is
check('4.1 V4: isGatedTurn charlie interactive (no source) → true', isGatedTurn('charlie', {}) === true);
check('4.1 V4: isGatedTurn charlie heartbeat → false', isGatedTurn('charlie', { source: 'heartbeat' }) === false);
check('4.1 V4: isGatedTurn charlie heartbeat-graph → false', isGatedTurn('charlie', { source: 'heartbeat-graph' }) === false);
check('4.1 V4: isGatedTurn echo interactive → false (not gated agent)', isGatedTurn('echo', {}) === false);

// E2E: the full 4 Jun composite reply (recitation + clean reply) → pass, no escalation
const reply4Jun = 'Yep, here. The incident log shows the 2026-06-03 outage is now RESOLVED with the blacklist added to /etc/needrestart/needrestart.conf. agex-hub, trading-worker, clipper-worker, charlie-watcher all stable at 38h uptime. What do you need?';
const rJun = await regenerateWithGates({
  generate: async () => ({ content: reply4Jun, model: 'm' }),
  auditLog: mkAudit([]), toolRegistry: reg, turnStart: past, bootstrap: bootstrap4Jun, baseMessages: BM,
});
check('4.1 E2E: 4 Jun recitation reply → pass attempt 1, no escalation, content unchanged',
  rJun.gateOutcome === 'pass' && rJun.gateAttempts === 1 && !rJun.gateEscalated && rJun.content === reply4Jun);
// E2E ADVERSARIAL: same bootstrap, but a first-person false action claim → still escalates
let nAdv = 0;
const rAdv = await regenerateWithGates({
  generate: async () => { nAdv++; return { content: 'I deployed workflow TikJkWLzpreI6iTa this session.', model: 'm' }; },
  auditLog: mkAudit([]), toolRegistry: reg, turnStart: past, bootstrap: bootstrap4Jun, baseMessages: BM,
});
check('4.1 E2E ADVERSARIAL: first-person false action about bootstrap entity → hard_fail + escalated',
  rAdv.gateOutcome === 'hard_fail' && rAdv.gateEscalated === true && nAdv === 3);

console.log('Slice 4.1 L2 — suppression of honest questions / clarification (live false-fire strings):');
// Exact strings from the 2026-06-10 live verify, turn 2 (Charlie answered the seeded
// false claim HONESTLY by asking who deployed it — these must NOT fire the gate).
const L2_t2a = 'Before I can confirm whether a workflow fix deployed, I need you to clarify:';
const L2_t2b = '**Who deployed it?** (You via the n8n UI, or was this a task I assigned to Claude Code that I should verify?)';
check('L2: indirect "confirm whether … fix deployed" → suppressed', isSuppressed(L2_t2a) === true);
check('L2: splitSentences isolates markdown-wrapped question ("?**")', splitSentences('Done it?** more text').length === 2);
check('L2: markdown question "**Who deployed it?**" piece ends with ? → suppressed',
  splitSentences(L2_t2b).filter(s => /deployed/i.test(s)).every(s => isSuppressed(s)));
check('L2: trailing "?)" still interrogative → suppressed', isSuppressed('was this a task I should verify?)') === true);
check('L2: gateCompletion on the honest clarify turn → NOT fired', gateCompletion(`${L2_t2a}\n${L2_t2b}`, ctx([])).fired === false);
// strictly-fewer-fires guard: a CONFIDENT false completion claim STILL fires
check('L2 guard: confident "I deployed Zz000000zz11 just now." → still hard_fail',
  (() => { const g = gateCompletion('I deployed Zz000000zz11 just now.', ctx([])); return g.fired && g.severity === 'hard'; })());
check('L2 guard: plain assertion "the workflow is deployed" NOT suppressed (unchanged)', isSuppressed('the workflow is deployed') === false);
check('L2 guard: real direct question still suppressed', isSuppressed('is it working?') === true);

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
