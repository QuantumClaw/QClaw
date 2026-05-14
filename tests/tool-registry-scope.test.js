/**
 * Tool registry scope tests.
 *
 * Run: node tests/tool-registry-scope.test.js
 *
 * Slice 3a: asserts that every tool registered through the public API
 * carries an explicit scope ('shared' or a non-empty array of agent
 * names), and that the legacy 3-arg registerSkillTool form is rejected
 * rather than silently coerced to 'shared'.
 *
 * Tests run against a fresh ToolRegistry with an empty config (no MCP
 * presets enabled) so they exercise only the registration paths under
 * test. tool-call.log writes are redirected via QCLAW_TOOL_CALL_LOG_PATH
 * to keep the user's ~/.quantumclaw/ untouched.
 */

import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'qclaw-tool-scope-'));
process.env.QCLAW_TOOL_CALL_LOG_PATH = join(tmp, 'tool-call.log');

const { ToolRegistry } = await import('../src/tools/registry.js');

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ─── Built-in scope ────────────────────────────────────────────────────
const r = new ToolRegistry({}, {});
await r.init();

const builtins = r.listTools().filter(t => t.source === 'built-in');
check('init() registers built-ins', builtins.length >= 4);
check('every built-in carries a scope', builtins.every(t => t.scope), `missing on: ${builtins.filter(t => !t.scope).map(t => t.name).join(',')}`);
check('built-ins default to shared', builtins.every(t => t.scope === 'shared'));

// ─── registerBuiltin public API ────────────────────────────────────────
r.registerBuiltin('test_tool', {
  scope: ['charlie'],
  description: 'test',
  fn: async () => 'ok',
});
const testEntry = r.listTools().find(t => t.name === 'test_tool');
check('registerBuiltin stores entry', !!testEntry);
check('registerBuiltin preserves array scope', Array.isArray(testEntry?.scope) && testEntry.scope[0] === 'charlie');

// ─── registerBuiltin rejects invalid scope ─────────────────────────────
let threw = false;
try {
  r.registerBuiltin('bad_tool', { description: 'x', fn: async () => 'x' });
} catch { threw = true; }
check('registerBuiltin rejects missing scope', threw);

threw = false;
try {
  r.registerBuiltin('bad_tool2', { scope: 'not-shared', description: 'x', fn: async () => 'x' });
} catch { threw = true; }
check("registerBuiltin rejects scope != 'shared' string", threw);

threw = false;
try {
  r.registerBuiltin('bad_tool3', { scope: [], description: 'x', fn: async () => 'x' });
} catch { threw = true; }
check('registerBuiltin rejects empty scope array', threw);

threw = false;
try {
  r.registerBuiltin('bad_tool4', { scope: ['charlie'], description: 'x' });
} catch { threw = true; }
check('registerBuiltin rejects missing fn', threw);

// ─── registerSkillTool 4-arg form ──────────────────────────────────────
const parsedSkill = { baseUrl: 'https://example.test', headers: {} };
const toolDef = { name: 'get_thing', description: 'd', inputSchema: { type: 'object' } };
r.registerSkillTool('charlie', 'demo', parsedSkill, toolDef);

const skillEntry = r.listTools().find(t => t.name === 'charlie__demo__get_thing');
check('registerSkillTool stores entry under agentName__skill__tool', !!skillEntry);
check('skill tool scope is [agentName]', Array.isArray(skillEntry?.scope) && skillEntry.scope[0] === 'charlie');

// ─── registerSkillTool rejects 3-arg form (no silent strip) ────────────
threw = false;
try {
  r.registerSkillTool('demo', parsedSkill, toolDef);
} catch (err) {
  threw = /4-arg form/.test(err.message);
}
check('registerSkillTool throws on legacy 3-arg call', threw);

// ─── Every registered tool has scope ───────────────────────────────────
const all = r.listTools();
const missing = all.filter(t => !t.scope);
check('every registered tool has scope', missing.length === 0, `missing: ${missing.map(t => t.name).join(',')}`);

// ─── tool-call.log writes registration events ──────────────────────────
const logPath = process.env.QCLAW_TOOL_CALL_LOG_PATH;
check('tool-call.log file exists', existsSync(logPath));
if (existsSync(logPath)) {
  const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
  check('tool-call.log contains registration lines', lines.length >= builtins.length);
  const parsed = lines.map(l => JSON.parse(l));
  check('each log entry has ts, event, source, tool, scope',
    parsed.every(e => e.ts && e.event === 'registration' && e.source && e.tool && e.scope));
}

// Cleanup
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
