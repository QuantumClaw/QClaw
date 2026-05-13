/**
 * Skill router tests.
 *
 * Run: node tests/skill-router.test.js
 *
 * Slice 2b Task 9 — original coverage: tokenization, exact-token
 * matching, density calculation, stable ordering, empty-message early
 * return, combination trigger filter (Emma + content-keyword for
 * content-studio).
 *
 * Slice 2c Tasks 1 + 2 — exhaustive per-keyword coverage (every keyword
 * in every on-demand skill's frontmatter routes to that skill), plus
 * combination edge cases (case, punctuation, tie-break, multi-line,
 * keyword-vs-skill-name).
 */

import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tokenize, routeKeywords } from '../src/agents/skill-router.js';

const __filename = fileURLToPath(import.meta.url);
const SKILLS_DIR = join(dirname(__filename), '..', 'src', 'agents', 'skills');

// Minimal YAML frontmatter parser — same shape as skill-loader.js.
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const fm = {};
  let lastKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (kv) {
      lastKey = kv[1];
      const val = kv[2].trim();
      fm[lastKey] = (val.startsWith('[') && val.endsWith(']'))
        ? val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
        : val;
      continue;
    }
    if (lastKey && /^\s+\S/.test(line)) {
      fm[lastKey] = (fm[lastKey] ? fm[lastKey] + ' ' : '') + line.trim();
    }
  }
  return fm;
}

function loadOnDemandCandidates() {
  const out = [];
  for (const file of readdirSync(SKILLS_DIR)) {
    if (!file.endsWith('.md')) continue;
    const fm = parseFrontmatter(readFileSync(join(SKILLS_DIR, file), 'utf-8'));
    if (!fm || fm.category !== 'on-demand') continue;
    out.push({ name: fm.name, keywords: Array.isArray(fm.keywords) ? fm.keywords : [] });
  }
  return out;
}

// Combination triggers — kept in sync with skill-router.js COMBINATION_TRIGGERS.
const COMBINATION_DISAMBIGUATOR = { 'content-studio': 'emma' };

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

// ─── Slice 2c Task 1: per-keyword exhaustive coverage ──────────────────
//
// Every keyword in every on-demand skill's frontmatter must route to
// its skill. Source of truth is the actual skill files — when frontmatter
// changes, this test moves with it (no hardcoded keyword lists).

const onDemandPool = loadOnDemandCandidates();
check('loaded on-demand candidate pool from frontmatter',
  onDemandPool.length >= 14, `got ${onDemandPool.length} on-demand skills`);

for (const cand of onDemandPool) {
  const disambig = COMBINATION_DISAMBIGUATOR[cand.name];
  const prefix = disambig ? `${disambig} ` : '';
  for (const kw of cand.keywords) {
    const message = `${prefix}${kw}`;
    const results = routeKeywords(message, onDemandPool);
    check(`keyword "${kw}" routes to "${cand.name}"`,
      results.some(r => r.name === cand.name),
      `got: ${results.map(r => r.name).join(', ') || '(no matches)'}`);
  }
}

// Token-boundary discipline — sample of "keyword as substring of larger
// word must NOT match" cases beyond the existing rebuilding case.
const boundaryCases = [
  { msg: 'shipping rates', kw: 'ship', skill: 'build' },
  { msg: 'testing the waters', kw: 'test', skill: 'qa' },
  { msg: 'tradingview integration', kw: 'trading', skill: 'trading' },
  { msg: 'positions in the org', kw: 'position', skill: 'trading' },
  { msg: 'customers list', kw: 'customer', skill: 'stripe' },
  { msg: 'workflows overview', kw: 'workflow', skill: 'n8n-api' },
];
for (const c of boundaryCases) {
  const results = routeKeywords(c.msg, onDemandPool);
  check(`"${c.msg}" does NOT match keyword "${c.kw}" (token-boundary)`,
    !results.some(r => r.name === c.skill),
    `unexpectedly matched: ${results.map(r => r.name).join(', ')}`);
}

// Case insensitivity — sample of keywords across upper / mixed / lower.
const caseSamples = ['BUILD', 'Build', 'build', 'STRIPE', 'Stripe', 'stripe', 'GHL', 'Ghl', 'ghl'];
for (const variant of caseSamples) {
  const results = routeKeywords(variant, onDemandPool);
  check(`case-insensitive keyword "${variant}" matches at least one skill`,
    results.length > 0,
    `got: ${results.map(r => r.name).join(', ')}`);
}

// Surrounding punctuation — keyword surrounded by punctuation tokens cleanly.
const punctSamples = ['build.', '(build)', 'build,', 'build!', 'build?', '"build"', 'build;', 'build:'];
for (const variant of punctSamples) {
  const results = routeKeywords(variant, onDemandPool);
  check(`punctuation-wrapped keyword "${variant}" still matches build`,
    results.some(r => r.name === 'build'),
    `got: ${results.map(r => r.name).join(', ')}`);
}

// ─── Slice 2c Task 2: combination-trigger edge cases ───────────────────

// (1) Density tie-break — 3-way and 4-way ties resolve by name asc.
const tie3 = [
  { name: 'beta', keywords: ['b'] },
  { name: 'alpha', keywords: ['a'] },
  { name: 'gamma', keywords: ['g'] },
];
const tie3r = routeKeywords('a b g', tie3);
check('3-way density tie sorts by name asc',
  tie3r.length === 3
    && tie3r[0].name === 'alpha'
    && tie3r[1].name === 'beta'
    && tie3r[2].name === 'gamma',
  `got: ${tie3r.map(r => r.name).join(', ')}`);

const tie4 = [
  { name: 'delta', keywords: ['d'] },
  { name: 'alpha', keywords: ['a'] },
  { name: 'charlie', keywords: ['c'] },
  { name: 'bravo', keywords: ['b'] },
];
const tie4r = routeKeywords('a b c d', tie4);
check('4-way density tie sorts by name asc',
  tie4r.length === 4
    && tie4r[0].name === 'alpha'
    && tie4r[1].name === 'bravo'
    && tie4r[2].name === 'charlie'
    && tie4r[3].name === 'delta',
  `got: ${tie4r.map(r => r.name).join(', ')}`);

// (2) Case sensitivity for combination — "EMMA Podcast" triggers content-studio.
const contentCandidates = [
  { name: 'content-studio', keywords: ['content', 'podcast', 'reel', 'buzzsprout'] },
];
check('"EMMA Podcast" (uppercase) triggers content-studio',
  routeKeywords('EMMA Podcast', contentCandidates).length === 1);
check('"Emma podcast" (mixed) triggers content-studio',
  routeKeywords('Emma podcast', contentCandidates).length === 1);
check('"emma PODCAST" (mixed) triggers content-studio',
  routeKeywords('emma PODCAST', contentCandidates).length === 1);

// (3) Leading / trailing punctuation around combination tokens.
check('"Emma\'s podcast?" triggers content-studio (apostrophe + question mark)',
  routeKeywords("Emma's podcast?", contentCandidates).length === 1);
check('"(Emma) [podcast]" triggers content-studio (brackets)',
  routeKeywords('(Emma) [podcast]', contentCandidates).length === 1);

// (4) Multi-line message matches keywords from each line.
const multiCands = [
  { name: 'build', keywords: ['build', 'fix'] },
  { name: 'trading', keywords: ['trade', 'scanner'] },
];
const multiR = routeKeywords('Build a thing.\n\nFix the trading scanner.', multiCands);
check('multi-line message matches keywords across lines',
  multiR.length === 2
    && multiR.some(r => r.name === 'build')
    && multiR.some(r => r.name === 'trading'),
  `got: ${multiR.map(r => r.name).join(', ')}`);

// (5) Skill name vs keyword — name is NOT used as a matchable surface.
// business-intelligence has keywords [revenue, mrr, reporting, bi, financials]
// and a name whose tokens (business, intelligence) are not in that list.
// A message containing only the skill name must not route to it.
const biPool = onDemandPool.find(c => c.name === 'business-intelligence');
if (biPool) {
  const noKwResults = routeKeywords('business-intelligence is broken', onDemandPool);
  check('"business-intelligence is broken" does NOT route to business-intelligence (skill name is not a keyword)',
    !noKwResults.some(r => r.name === 'business-intelligence'),
    `got: ${noKwResults.map(r => r.name).join(', ')}`);

  const kwResults = routeKeywords('mrr is broken', onDemandPool);
  check('"mrr is broken" routes to business-intelligence (keyword match)',
    kwResults.some(r => r.name === 'business-intelligence'),
    `got: ${kwResults.map(r => r.name).join(', ')}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
