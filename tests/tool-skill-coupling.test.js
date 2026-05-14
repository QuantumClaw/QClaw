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
 * Runs against actual src/agents/skills/ (ghl.md / stripe.md declare
 * ownership via the new frontmatter `tools:` field; trading-api.md /
 * n8n-api.md / n8n-router.md own their tools via the implicit
 * <agent>__<skill>__* prefix). tool-call.log writes redirected via
 * QCLAW_TOOL_CALL_LOG_PATH.
 */

import { mkdtempSync, rmSync } from 'fs';
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

// ── Cleanup
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
