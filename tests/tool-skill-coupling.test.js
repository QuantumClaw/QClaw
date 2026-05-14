/**
 * Tool ↔ skill coupling tests.
 *
 * Run: node tests/tool-skill-coupling.test.js
 *
 * Slice 3b: asserts that ToolRegistry.registerForRequest gates the
 * tool list by skill routing — on-demand skill tools appear only when
 * their skill is in the SkillLoadResult, shared tools are always
 * visible, and the cleanup handle restores boot-time behaviour.
 *
 * Slice 3b.1 extends the test with:
 *   - tool-call.log file assertions for the new 'on_demand_routing'
 *     and 'deregistration' events emitted per registerForRequest call
 *     (verifies the gate fires observably, not only in-process state).
 *   - end-to-end check that drives Agent._processNonReflex with a
 *     stub router + stub toolExecutor and confirms the gate fires
 *     through the actual integration point, not just the unit-test
 *     in-process API. Catches the class of regression that produced
 *     PR #19 ("test green, runtime broken").
 *
 * Runs against actual src/agents/skills/ (ghl.md / stripe.md declare
 * ownership via the new frontmatter `tools:` field; trading-api.md /
 * n8n-api.md / n8n-router.md own their tools via the implicit
 * <agent>__<skill>__* prefix). tool-call.log writes redirected via
 * QCLAW_TOOL_CALL_LOG_PATH.
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'qclaw-tool-coupling-'));
process.env.QCLAW_TOOL_CALL_LOG_PATH = join(tmp, 'tool-call.log');

const { ToolRegistry } = await import('../src/tools/registry.js');
const { loadSkills } = await import('../src/agents/skill-loader.js');

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

const r = new ToolRegistry({}, {});
await r.init();

// Seed domain tools that mimic the live runtime: ghl preset, stripe
// preset, and a few skill HTTP tools registered the way Agent.load()
// would have done. Keep parsedSkill minimal — baseUrl + headers only.
const parsedGhlSkill = { baseUrl: 'https://example.test', headers: {} };
const parsedStripeSkill = { baseUrl: 'https://example.test', headers: {} };
const parsedTradingSkill = { baseUrl: 'https://example.test', headers: {} };
const parsedN8nApiSkill = { baseUrl: 'https://example.test', headers: {} };

// Preset-style entries (ghl__*, stripe__*) — manually seeded so the
// test does not need real MCP config. Bypasses _registerAPITools and
// goes straight into the internal map, mirroring the post-init shape.
r._apiTools.set('ghl__search_contacts', {
  preset: { name: 'ghl', baseUrl: 'https://example.test', headers: {} },
  toolDef: { name: 'search_contacts', description: 'd', inputSchema: { type: 'object' } },
  scope: ['charlie'],
});
r._apiTools.set('stripe__list_customers', {
  preset: { name: 'stripe', baseUrl: 'https://example.test', headers: {} },
  toolDef: { name: 'list_customers', description: 'd', inputSchema: { type: 'object' } },
  scope: ['charlie'],
});
r._apiTools.set('youtube__search_videos', {
  preset: { name: 'youtube', baseUrl: 'https://example.test', headers: {} },
  toolDef: { name: 'search_videos', description: 'd', inputSchema: { type: 'object' } },
  scope: 'shared',
});

// Skill HTTP entries (charlie__<skill>__*).
r.registerSkillTool('charlie', 'ghl', parsedGhlSkill, { name: 'get_contacts_contact_id', description: 'd', inputSchema: {} });
r.registerSkillTool('charlie', 'stripe', parsedStripeSkill, { name: 'get_customers', description: 'd', inputSchema: {} });
r.registerSkillTool('charlie', 'trading-api', parsedTradingSkill, { name: 'get_simulations', description: 'd', inputSchema: {} });
r.registerSkillTool('charlie', 'n8n-api', parsedN8nApiSkill, { name: 'get_workflows_limit_200', description: 'd', inputSchema: {} });

// Sanity check the boot-time state: no gate, all visible.
const bootListed = r.getToolDefinitions().map(t => t.name);
check('boot-time getToolDefinitions returns shared + domain tools',
  bootListed.includes('get_current_time') &&
  bootListed.includes('ghl__search_contacts') &&
  bootListed.includes('youtube__search_videos') &&
  bootListed.includes('charlie__ghl__get_contacts_contact_id'));

// ── Case A: generic message — no on-demand skill routes ─────────────────
const genericResult = await loadSkills({ agent: 'charlie', message: 'hello there' });
const releaseA = r.registerForRequest(genericResult, 'charlie');
const activeA = r.getToolDefinitions().map(t => t.name);
check('shared tool stays visible without routing (get_current_time)', activeA.includes('get_current_time'));
check('shared tool stays visible without routing (web_fetch)', activeA.includes('web_fetch'));
check('shared preset stays visible (youtube__search_videos)', activeA.includes('youtube__search_videos'));
check('domain preset hidden without skill (ghl__search_contacts)', !activeA.includes('ghl__search_contacts'));
check('domain preset hidden without skill (stripe__list_customers)', !activeA.includes('stripe__list_customers'));
check('skill HTTP tool hidden without skill (charlie__ghl__*)', !activeA.includes('charlie__ghl__get_contacts_contact_id'));
check('skill HTTP tool hidden without skill (charlie__trading-api__*)', !activeA.includes('charlie__trading-api__get_simulations'));

// out_of_scope structured error for a hidden tool
const ghlAttempt = await r.executeTool('ghl__search_contacts', {});
check('executeTool returns structured out_of_scope for hidden domain tool',
  ghlAttempt && ghlAttempt.error === 'out_of_scope' && typeof ghlAttempt.suggestion === 'string');
check('out_of_scope suggestion mentions owning skill',
  ghlAttempt.suggestion.includes('ghl'));

releaseA();

// ── Case B: ghl-routing message — ghl tools come online ─────────────────
const ghlResult = await loadSkills({ agent: 'charlie', message: 'find any ghl contacts please' });
const releaseB = r.registerForRequest(ghlResult, 'charlie');
const activeB = r.getToolDefinitions().map(t => t.name);
check('ghl-routed: skill HTTP visible', activeB.includes('charlie__ghl__get_contacts_contact_id'));
check('ghl-routed: declared preset visible (frontmatter tools field)', activeB.includes('ghl__search_contacts'));
check('ghl-routed: stripe still hidden', !activeB.includes('stripe__list_customers'));
check('ghl-routed: trading-api still hidden', !activeB.includes('charlie__trading-api__get_simulations'));
releaseB();

// ── Case C: trading-routing message — implicit prefix ownership ─────────
const tradingResult = await loadSkills({ agent: 'charlie', message: 'show the trading scanner status' });
const releaseC = r.registerForRequest(tradingResult, 'charlie');
const activeC = r.getToolDefinitions().map(t => t.name);
check('trading-routed: charlie__trading-api__* visible via implicit prefix',
  activeC.includes('charlie__trading-api__get_simulations'));
check('trading-routed: ghl still hidden', !activeC.includes('charlie__ghl__get_contacts_contact_id'));
releaseC();

// ── Case D: stripe-routing message — preset + skill both come online ────
const stripeResult = await loadSkills({ agent: 'charlie', message: 'list a stripe customer' });
const releaseD = r.registerForRequest(stripeResult, 'charlie');
const activeD = r.getToolDefinitions().map(t => t.name);
check('stripe-routed: declared preset visible', activeD.includes('stripe__list_customers'));
check('stripe-routed: skill HTTP visible (charlie__stripe__*)', activeD.includes('charlie__stripe__get_customers'));
releaseD();

// ── Cleanup: post-release returns to boot-time view ─────────────────────
const afterRelease = r.getToolDefinitions().map(t => t.name);
check('after cleanup, ghl tools visible again (no gate)', afterRelease.includes('ghl__search_contacts'));
check('after cleanup, every seeded tool visible again',
  ['get_current_time', 'web_fetch', 'ghl__search_contacts', 'stripe__list_customers',
   'youtube__search_videos', 'charlie__ghl__get_contacts_contact_id',
   'charlie__trading-api__get_simulations'].every(n => afterRelease.includes(n)));

// ── No leak across messages: sequential register-release-register ───────
const r1 = r.registerForRequest(genericResult, 'charlie');
const generic2 = r.getToolDefinitions().map(t => t.name);
r1();
const r2 = r.registerForRequest(ghlResult, 'charlie');
const ghl2 = r.getToolDefinitions().map(t => t.name);
r2();
check('no leak: first message generic, no ghl visible', !generic2.includes('ghl__search_contacts'));
check('no leak: second message ghl, ghl visible', ghl2.includes('ghl__search_contacts'));
check('no leak: stripe still gated on second message', !ghl2.includes('stripe__list_customers'));

// ── Slice 3b.1: log-file assertions ─────────────────────────────────────
// Read the tool-call.log file written by every registerForRequest call
// in this test and verify the new event types appear. This is the bar
// that was missing from Slice 3b — log inspection on the live runtime
// after PR #19 found zero per-message events because the gate only
// emitted activation records for on-demand-routed tools, and generic
// messages routed no on-demand skills. After 3b.1 every registerForRequest
// call emits exactly one 'on_demand_routing' summary record, and the
// cleanup handle emits exactly one 'deregistration' record.

const logLines = readFileSync(process.env.QCLAW_TOOL_CALL_LOG_PATH, 'utf-8')
  .trim()
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l));

const routingEvents = logLines.filter(e => e.event === 'on_demand_routing');
const deregistrationEvents = logLines.filter(e => e.event === 'deregistration');
const activationEvents = logLines.filter(e => e.event === 'activation');

// Six registerForRequest calls in this test (A/B/C/D/r1/r2) so we
// expect six 'on_demand_routing' and six 'deregistration' records.
check('tool-call.log has 6 on_demand_routing records (one per registerForRequest)',
  routingEvents.length === 6,
  `got ${routingEvents.length}`);
check('tool-call.log has 6 deregistration records (one per cleanup)',
  deregistrationEvents.length === 6,
  `got ${deregistrationEvents.length}`);

// Generic message (Case A) must show NO activated_by_skill entries —
// this is the load-bearing assertion the live runtime previously failed.
const genericRouting = routingEvents[0];
check('on_demand_routing generic-message: routed_on_demand_skills is empty',
  Array.isArray(genericRouting.routed_on_demand_skills) && genericRouting.routed_on_demand_skills.length === 0);
check('on_demand_routing generic-message: activated_by_skill is empty',
  Array.isArray(genericRouting.activated_by_skill) && genericRouting.activated_by_skill.length === 0);
check('on_demand_routing generic-message: active_set_size > 0 (shared tools still active)',
  typeof genericRouting.active_set_size === 'number' && genericRouting.active_set_size > 0);

// Case B (ghl-routed): the routing record names ghl and activates ghl tools.
const ghlRouting = routingEvents[1];
check('on_demand_routing ghl-message: routed_on_demand_skills includes "ghl"',
  ghlRouting.routed_on_demand_skills.includes('ghl'));
check('on_demand_routing ghl-message: activated_by_skill includes ghl__search_contacts',
  ghlRouting.activated_by_skill.includes('ghl__search_contacts'));
check('on_demand_routing ghl-message: activated_by_skill includes charlie__ghl__*',
  ghlRouting.activated_by_skill.some(t => t.startsWith('charlie__ghl__')));

// Case C (trading-routed): the routing record names trading-api and
// activates charlie__trading-api__* via implicit prefix ownership.
const tradingRouting = routingEvents[2];
check('on_demand_routing trading-message: routed_on_demand_skills includes "trading-api"',
  tradingRouting.routed_on_demand_skills.includes('trading-api'));
check('on_demand_routing trading-message: activated_by_skill includes charlie__trading-api__*',
  tradingRouting.activated_by_skill.some(t => t.startsWith('charlie__trading-api__')));

// Granular activation records still emit per skill-coupled tool — these
// supplement the summary; should match the sum across routing records.
const totalActivated = routingEvents.reduce((sum, e) => sum + e.activated_by_skill.length, 0);
check('activation records sum matches activated_by_skill totals',
  activationEvents.length === totalActivated,
  `activations=${activationEvents.length}, summary-total=${totalActivated}`);

// ── Slice 3b.1: end-to-end integration via Agent._processNonReflex ──────
// Drives the actual integration point that PR #19 claimed to verify but
// did not. Builds a minimal Agent with stub router + stub toolExecutor;
// calls agent.process(); reads the log to confirm a 'on_demand_routing'
// record appears for the message text, with the right skill names.
// If _processNonReflex skips the gate (the runtime regression the
// brief calls Shape B), this assertion fails.

const { Agent } = await import('../src/agents/registry.js');

// Stub router — minimum surface Agent.process / _processNonReflex needs.
const stubRouter = {
  classify: (_text) => ({
    tier: 'standard',
    extendedContext: false,
    model: 'stub-model',
    response: null,
  }),
  complete: async (_messages, _opts) => ({
    content: 'stub-response',
    model: 'stub-model',
    usage: { input_tokens: 0, output_tokens: 0 },
    cost: 0,
    duration: 0,
  }),
};

// Stub toolExecutor — captures the tool definitions visible to the LLM
// for each run() invocation. Returns immediately without invoking any
// tool so we can assert on the gated tool-list without LLM I/O.
let capturedToolDefs = [];
const stubToolExecutor = {
  tools: r,
  run: async (_messages, _opts) => {
    capturedToolDefs = r.getToolDefinitions();
    return { content: 'stub-response', model: 'stub-model', usage: { input_tokens: 0, output_tokens: 0 }, cost: 0, duration: 0, toolCalls: [] };
  },
};

// Minimal memory stub — getHistory + addMessage are what _processNonReflex calls.
const stubMemory = {
  graphQuery: async () => ({ results: [] }),
  knowledge: null,
  getHistory: () => [],
  addMessage: () => {},
};

const stubAudit = { log: () => {} };
const stubTrustKernel = { getContext: () => '' };

// Construct Agent on a temp dir so SOUL/skills loading doesn't fail.
const agentDir = mkdtempSync(join(tmpdir(), 'qclaw-coupling-agent-'));
const agent = new Agent('charlie', agentDir, {
  router: stubRouter,
  memory: stubMemory,
  audit: stubAudit,
  toolExecutor: stubToolExecutor,
  toolRegistry: r,
  trustKernel: stubTrustKernel,
  config: { agent: { hatched: true } },
});

// Snapshot log size so we can isolate per-message entries.
let beforeLines = readFileSync(process.env.QCLAW_TOOL_CALL_LOG_PATH, 'utf-8').split('\n').length;

await agent.process('hello there', { channel: 'test', userId: 'integration-test' });

let afterLines = readFileSync(process.env.QCLAW_TOOL_CALL_LOG_PATH, 'utf-8')
  .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const newEntries = afterLines.slice(beforeLines - 1);
const newRouting = newEntries.find(e => e.event === 'on_demand_routing');
const newDereg = newEntries.find(e => e.event === 'deregistration');
check('end-to-end: agent.process emits on_demand_routing record', !!newRouting);
check('end-to-end: agent.process emits deregistration record', !!newDereg);
check('end-to-end: generic message produces empty routed_on_demand_skills',
  newRouting && newRouting.routed_on_demand_skills.length === 0);
check('end-to-end: stub LLM saw shared tools (get_current_time)',
  capturedToolDefs.some(t => t.name === 'get_current_time'));
check('end-to-end: stub LLM did NOT see ghl preset (gate narrowed it)',
  !capturedToolDefs.some(t => t.name === 'ghl__search_contacts'));

// Second message — ghl-routing keyword. Verify routing summary names ghl
// and the stub LLM sees ghl tools this time.
beforeLines = readFileSync(process.env.QCLAW_TOOL_CALL_LOG_PATH, 'utf-8').split('\n').length;
await agent.process('what ghl contacts do we have', { channel: 'test', userId: 'integration-test' });
afterLines = readFileSync(process.env.QCLAW_TOOL_CALL_LOG_PATH, 'utf-8')
  .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const ghlNewEntries = afterLines.slice(beforeLines - 1);
const ghlNewRouting = ghlNewEntries.find(e => e.event === 'on_demand_routing');
check('end-to-end: ghl-keyword message routes ghl skill',
  ghlNewRouting && ghlNewRouting.routed_on_demand_skills.includes('ghl'));
check('end-to-end: stub LLM saw ghl tools after routing',
  capturedToolDefs.some(t => t.name === 'ghl__search_contacts'));

// ── Cleanup
rmSync(tmp, { recursive: true, force: true });
rmSync(agentDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
