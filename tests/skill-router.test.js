/**
 * Skill router tests.
 *
 * Run: node tests/skill-router.test.js
 *
 * Slice 2b Task 9. Covers tokenization, exact-token matching, density
 * calculation, stable ordering, empty-message early return, combination
 * trigger filter (Emma + content-keyword for content-studio).
 */

import { tokenize, routeKeywords } from '../src/agents/skill-router.js';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ─── Tokenize ──────────────────────────────────────────────────────────
check('tokenize empty', JSON.stringify(tokenize('')) === '[]');
check('tokenize null', JSON.stringify(tokenize(null)) === '[]');
check('tokenize undefined', JSON.stringify(tokenize(undefined)) === '[]');
check('tokenize "build a thing"', JSON.stringify(tokenize('build a thing')) === '["build","a","thing"]');
check('tokenize splits on dots', JSON.stringify(tokenize('portal.flowos.tech')) === '["portal","flowos","tech"]');
check('tokenize splits on hyphens', JSON.stringify(tokenize('portal-flowos')) === '["portal","flowos"]');
check('tokenize lowercases', JSON.stringify(tokenize('Build A Thing')) === '["build","a","thing"]');
check('tokenize trims punctuation runs', JSON.stringify(tokenize('build!!! a thing??')) === '["build","a","thing"]');

// ─── Exact-token matching ──────────────────────────────────────────────
const candidates1 = [
  { name: 'build', keywords: ['build'] },
];

check('"build" matches keyword "build"',
  routeKeywords('build', candidates1).length === 1);

check('"build a thing" matches keyword "build"',
  routeKeywords('build a thing', candidates1).length === 1);

check('"rebuilding" does NOT match keyword "build" (no prefix matching)',
  routeKeywords('rebuilding the system', candidates1).length === 0);

check('"BUILDING" — "building" doesn\'t match "build"',
  routeKeywords('BUILDING something', candidates1).length === 0);

// ─── Multi-token keyword (hyphenated) ──────────────────────────────────
const candidates2 = [
  { name: 'cm-flow-os', keywords: ['portal-flowos'] },
];

check('multi-token keyword "portal-flowos" matches "portal.flowos.tech"',
  routeKeywords('check the portal.flowos.tech status', candidates2).length === 1);

check('multi-token keyword "portal-flowos" requires BOTH tokens',
  routeKeywords('check portal.example.tech', candidates2).length === 0);

// ─── Density calculation ───────────────────────────────────────────────
const candidates3 = [
  { name: 'build', keywords: ['build', 'fix'] },
];

const r3 = routeKeywords('build fix', candidates3);
check('density "build fix" against [build,fix] = 1.0 (2 matches in 2 tokens)',
  r3.length === 1 && Math.abs(r3[0].density - 1.0) < 1e-9,
  `got density ${r3[0]?.density}`);

const r3b = routeKeywords('build a fix', candidates3);
check('density "build a fix" against [build,fix] = 2/3',
  r3b.length === 1 && Math.abs(r3b[0].density - 2/3) < 1e-9,
  `got density ${r3b[0]?.density}`);

const r3c = routeKeywords('build', candidates3);
check('density "build" against [build,fix] = 1/1 (1 match in 1 token)',
  r3c.length === 1 && Math.abs(r3c[0].density - 1.0) < 1e-9,
  `got density ${r3c[0]?.density}`);

// ─── Stable ordering: density desc, then name asc ──────────────────────
const candidates4 = [
  { name: 'zebra', keywords: ['z'] },
  { name: 'alpha', keywords: ['a'] },
  { name: 'middle', keywords: ['m'] },
];
const r4 = routeKeywords('a z m', candidates4);
check('three skills tie on density 0.33 — sorted alphabetically',
  r4.length === 3 && r4[0].name === 'alpha' && r4[1].name === 'middle' && r4[2].name === 'zebra',
  `got: ${r4.map(r => r.name).join(', ')}`);

// Density-based ordering wins over alphabetical
const candidates5 = [
  { name: 'aaa', keywords: ['rare'] },          // 1 match → density 0.5 in "rare token"
  { name: 'zzz', keywords: ['rare', 'token'] },  // 2 matches → density 1.0 in "rare token"
];
const r5 = routeKeywords('rare token', candidates5);
check('higher density skill ordered first regardless of name',
  r5.length === 2 && r5[0].name === 'zzz' && r5[1].name === 'aaa',
  `got: ${r5.map(r => r.name + '@' + r.density).join(', ')}`);

// ─── Empty message ─────────────────────────────────────────────────────
check('empty message returns []',
  routeKeywords('', candidates1).length === 0);
check('whitespace-only message returns []',
  routeKeywords('   \n\t  ', candidates1).length === 0);
check('punctuation-only message returns []',
  routeKeywords('!!!.,.', candidates1).length === 0);

// ─── Combination trigger: content-studio needs Emma ────────────────────
const candidates6 = [
  { name: 'content-studio', keywords: ['content', 'podcast', 'reel', 'buzzsprout'] },
];

check('"podcast today" alone does NOT trigger content-studio',
  routeKeywords('record a podcast today', candidates6).length === 0);

check('"emma podcast today" triggers content-studio',
  routeKeywords('emma podcast today', candidates6).length === 1);

check('"reel for Emma" triggers content-studio',
  routeKeywords('cut a reel for emma', candidates6).length === 1);

// Skill name not content-studio shouldn't get the combination filter applied.
const candidates7 = [
  { name: 'other-skill', keywords: ['podcast'] },
];
check('combination filter only applies to content-studio',
  routeKeywords('record a podcast today', candidates7).length === 1);

// ─── Skills with empty keywords array are skipped ──────────────────────
const candidates8 = [
  { name: 'no-kw', keywords: [] },
  { name: 'undef-kw', keywords: undefined },
  { name: 'real-kw', keywords: ['real'] },
];
const r8 = routeKeywords('real keyword test', candidates8);
check('candidates with empty/missing keywords are skipped',
  r8.length === 1 && r8[0].name === 'real-kw');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
