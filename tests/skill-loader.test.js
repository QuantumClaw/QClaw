/**
 * Skill loader tests.
 *
 * Run: node tests/skill-loader.test.js
 *
 * Slice 2b Task 9. Covers SkillLoadResult shape, always-on partition,
 * on-demand routing + hard-cap-4, archive/specialist-scope exclusion,
 * combination trigger via loadSkills, bootstrap.skills.always_on cache
 * reuse, and skill-load.log writes.
 *
 * Tests run against actual src/agents/skills/ — uses QCLAW_SKILL_LOG_PATH
 * to keep log writes out of ~/.quantumclaw/.
 */

import { mkdtempSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'qclaw-skill-loader-'));
process.env.QCLAW_SKILL_LOG_PATH = join(tmp, 'skill-load.log');

// Import AFTER setting env so the module sees it.
const { loadSkills } = await import('../src/agents/skill-loader.js');

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ─── Shape ─────────────────────────────────────────────────────────────
const r1 = await loadSkills({ agent: 'charlie', message: '' });
check('result has always_on array', Array.isArray(r1.always_on));
check('result has on_demand array', Array.isArray(r1.on_demand));
check('result has considered_but_dropped array', Array.isArray(r1.considered_but_dropped));
check('result has total_token_estimate number', typeof r1.total_token_estimate === 'number' && r1.total_token_estimate > 0);

// ─── Always-on for empty message ───────────────────────────────────────
check('empty message produces always_on', r1.always_on.length >= 5,
  `got ${r1.always_on.length} always-on skills`);
check('empty message produces 0 on_demand', r1.on_demand.length === 0);

const expectedAlwaysOn = ['identity', 'lanes', 'verification-reflexes', 'delegation', 'bootstrap-awareness', 'architecture-pillars', 'security'];
for (const expected of expectedAlwaysOn) {
  check(`always_on includes "${expected}"`, r1.always_on.some(s => s.name === expected));
}

// Always-on entries have full content + frontmatter
const idSkill = r1.always_on.find(s => s.name === 'identity');
check('always_on entry has content', idSkill && idSkill.content && idSkill.content.length > 0);
check('always_on entry has frontmatter', idSkill && idSkill.frontmatter && idSkill.frontmatter.category === 'always-on');

// ─── On-demand routing ─────────────────────────────────────────────────
const r2 = await loadSkills({ agent: 'charlie', message: 'build a fix' });
check('"build a fix" produces on_demand match', r2.on_demand.length > 0);
check('on_demand "build a fix" includes build skill',
  r2.on_demand.some(s => s.name === 'build'));

const buildEntry = r2.on_demand.find(s => s.name === 'build');
check('on_demand entry has matched_keywords',
  buildEntry && Array.isArray(buildEntry.matched_keywords) && buildEntry.matched_keywords.length > 0);
check('on_demand entry has density > 0', buildEntry && buildEntry.density > 0);

// ─── No-match doesn't appear in dropped ────────────────────────────────
const r3 = await loadSkills({ agent: 'charlie', message: 'build a fix' });
const dropNames = new Set(r3.considered_but_dropped.map(s => s.name));
check('skill with zero keyword matches is NOT in considered_but_dropped',
  !dropNames.has('stripe') && !dropNames.has('clipper'),
  `dropped names: ${[...dropNames].join(', ')}`);

// ─── Hard-cap-4 ────────────────────────────────────────────────────────
// Message that should match more than 4 on-demand skills.
const r4 = await loadSkills({
  agent: 'charlie',
  message: 'stripe customer trading position ghl contact community emma podcast build fix qa test n8n workflow',
});
check('hard-cap-4 honoured: on_demand.length <= 4',
  r4.on_demand.length <= 4, `got ${r4.on_demand.length}`);
check('overflow goes to considered_but_dropped',
  r4.considered_but_dropped.length > 0, `dropped count: ${r4.considered_but_dropped.length}`);
check('all dropped have reason "hard-cap-4"',
  r4.considered_but_dropped.every(s => s.reason === 'hard-cap-4'));

// ─── Archive + specialist-scope excluded from all buckets ──────────────
const r5 = await loadSkills({ agent: 'charlie', message: 'meta ads agency campaign emma podcast crete' });
const allNames = [
  ...r5.always_on.map(s => s.name),
  ...r5.on_demand.map(s => s.name),
  ...r5.considered_but_dropped.map(s => s.name),
];
check('charlie-cto (archived) NOT in any output bucket',
  !allNames.includes('charlie-cto'));
check('agent-coordination (archived) NOT in any output bucket',
  !allNames.includes('agent-coordination'));
check('ads-agency (specialist-scope) NOT in any output bucket',
  !allNames.includes('ads-agency'),
  `appeared in: ${allNames.join(', ')}`);
check('crete-marketing (specialist-scope) NOT in any output bucket',
  !allNames.includes('crete-marketing'));
check('ghl-marketing (specialist-scope) NOT in any output bucket',
  !allNames.includes('ghl-marketing'));

// ─── Combination trigger via loadSkills ────────────────────────────────
const r6a = await loadSkills({ agent: 'charlie', message: 'record a podcast today' });
const r6aNames = r6a.on_demand.map(s => s.name);
check('"podcast today" alone does NOT load content-studio via loadSkills',
  !r6aNames.includes('content-studio'),
  `on_demand: ${r6aNames.join(', ')}`);

const r6b = await loadSkills({ agent: 'charlie', message: 'emma podcast today' });
const r6bNames = r6b.on_demand.map(s => s.name);
check('"emma podcast" loads content-studio via loadSkills',
  r6bNames.includes('content-studio'),
  `on_demand: ${r6bNames.join(', ')}`);

// ─── Bootstrap cache reuse ─────────────────────────────────────────────
const cachedAlwaysOn = [
  { name: 'cached-skill', content: 'cached content', frontmatter: { category: 'always-on' } },
];
const r7 = await loadSkills({
  agent: 'charlie',
  message: '',
  bootstrap: { skills: { always_on: cachedAlwaysOn } },
});
check('bootstrap.skills.always_on is reused when present',
  r7.always_on.length === 1 && r7.always_on[0].name === 'cached-skill');

// ─── skill-load.log writes ─────────────────────────────────────────────
check('skill-load.log file exists', existsSync(process.env.QCLAW_SKILL_LOG_PATH));

const logContent = readFileSync(process.env.QCLAW_SKILL_LOG_PATH, 'utf-8');
const logLines = logContent.trim().split('\n').filter(Boolean);
check('skill-load.log has one line per loadSkills call',
  logLines.length >= 6, `got ${logLines.length} lines`);

const firstEntry = JSON.parse(logLines[0]);
check('log entry has ts (ISO timestamp)',
  typeof firstEntry.ts === 'string' && firstEntry.ts.includes('T'));
check('log entry has agentName', firstEntry.agentName === 'charlie');
check('log entry has always_on array', Array.isArray(firstEntry.always_on));
check('log entry has on_demand array', Array.isArray(firstEntry.on_demand));
check('log entry has dropped array', Array.isArray(firstEntry.dropped));
check('log entry has total_chars', typeof firstEntry.total_chars === 'number' && firstEntry.total_chars > 0);

// ─── Cleanup ───────────────────────────────────────────────────────────
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
