#!/usr/bin/env node
/**
 * Slice 3b.1 verification harness.
 *
 * Runs three Agent.process() calls (generic / ghl / trading-api) against
 * the live ToolRegistry, with stub router + stub toolExecutor so no LLM
 * round-trip occurs. Prints the tool-call.log entries the run produced,
 * so the PR description can carry an actual log excerpt rather than a
 * claim.
 *
 * Use:
 *   node scripts/verify-coupling.js
 *
 * Writes tool-call.log to QCLAW_TOOL_CALL_LOG_PATH (defaults to a temp
 * file) so the live ~/.quantumclaw/tool-call.log is untouched.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

if (!process.env.QCLAW_TOOL_CALL_LOG_PATH) {
  const dir = mkdtempSync(join(tmpdir(), 'qclaw-verify-coupling-'));
  process.env.QCLAW_TOOL_CALL_LOG_PATH = join(dir, 'tool-call.log');
}

const { ToolRegistry } = await import('../src/tools/registry.js');
const { Agent } = await import('../src/agents/registry.js');

// Build the registry as the live runtime would, including the preset
// HTTP entries the live process loaded at boot. _registerAPITools is
// the private path init() uses for type:'api' presets, so we drive
// it directly with the production scope map applied.
const r = new ToolRegistry({}, {
  // Secrets stub — the registry only reads .get() during execution,
  // which the stub LLM never triggers here.
  get: () => null,
});
await r.init();

// Seed the runtime preset shape for ghl + stripe + youtube. youtube is
// scope:'shared' so it stays visible regardless of routing — confirms
// the gate is narrowing the domain tools without collapsing the shared
// tier.
r._apiTools.set('ghl__search_contacts', {
  preset: { name: 'ghl' },
  toolDef: { name: 'search_contacts', description: 'd', inputSchema: { type: 'object' } },
  scope: ['charlie'],
});
r._apiTools.set('stripe__list_customers', {
  preset: { name: 'stripe' },
  toolDef: { name: 'list_customers', description: 'd', inputSchema: { type: 'object' } },
  scope: ['charlie'],
});
r._apiTools.set('youtube__search_videos', {
  preset: { name: 'youtube' },
  toolDef: { name: 'search_videos', description: 'd', inputSchema: { type: 'object' } },
  scope: 'shared',
});

r.registerSkillTool('charlie', 'ghl',
  { baseUrl: 'https://example.test', headers: {} },
  { name: 'get_contacts_contact_id', description: 'd', inputSchema: {} });
r.registerSkillTool('charlie', 'trading-api',
  { baseUrl: 'https://example.test', headers: {} },
  { name: 'get_simulations', description: 'd', inputSchema: {} });

let toolsVisibleToLLM = [];
const stubRouter = {
  classify: () => ({ tier: 'standard', extendedContext: false, model: 'stub', response: null }),
  complete: async () => ({ content: 'stub', model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, cost: 0, duration: 0 }),
};
const stubExecutor = {
  tools: r,
  run: async () => {
    toolsVisibleToLLM = r.getToolDefinitions().map(t => t.name).sort();
    return { content: 'stub', model: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, cost: 0, duration: 0, toolCalls: [] };
  },
};
const stubMemory = { graphQuery: async () => ({ results: [] }), knowledge: null, getHistory: () => [], addMessage: () => {} };
const stubAudit = { log: () => {} };
const stubTrustKernel = { getContext: () => '' };

const agentDir = mkdtempSync(join(tmpdir(), 'qclaw-verify-coupling-agent-'));
const agent = new Agent('charlie', agentDir, {
  router: stubRouter,
  memory: stubMemory,
  audit: stubAudit,
  toolExecutor: stubExecutor,
  toolRegistry: r,
  trustKernel: stubTrustKernel,
  config: { agent: { hatched: true } },
});

// Wipe the log so the excerpt is the per-message events only.
writeFileSync(process.env.QCLAW_TOOL_CALL_LOG_PATH, '');

const cases = [
  { label: 'generic',     message: 'hello, how are things' },
  { label: 'ghl-routing', message: 'what ghl contacts do we have' },
  { label: 'trading',     message: 'show me the trading scanner status' },
];

for (const c of cases) {
  await agent.process(c.message, { channel: 'verify-script', userId: 'verify' });
  // eslint-disable-next-line no-console
  console.log(`[${c.label}] tools visible to stub LLM: ${toolsVisibleToLLM.length} (` +
    `${toolsVisibleToLLM.filter(n => n.startsWith('ghl__') || n.startsWith('stripe__') || n.startsWith('charlie__')).join(', ') || 'shared only'})`);
}

// eslint-disable-next-line no-console
console.log('\n--- tool-call.log excerpt (verification run) ---');
const lines = readFileSync(process.env.QCLAW_TOOL_CALL_LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean);
for (const l of lines) {
  // eslint-disable-next-line no-console
  console.log(l);
}
