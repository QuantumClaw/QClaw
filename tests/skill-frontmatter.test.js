/**
 * Skill frontmatter validation tests.
 *
 * Run: node tests/skill-frontmatter.test.js
 *
 * Slice 2a Task 7. Verifies every .md file in src/agents/skills/ has
 * valid YAML frontmatter conforming to the spec:
 *   - name (required)
 *   - category in {always-on, on-demand, specialist-scope, archive}
 *   - surface in {prompt, tool, both}
 *   - keywords (required iff category=on-demand, must be a list)
 *   - description (required, one-line)
 *
 * Also enforces:
 *   - No two skills share the same name
 *   - Skills with surface=tool or surface=both have a "## Endpoints"
 *     heading (audit T10 footgun guard)
 */

import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const SKILLS_DIR = join(dirname(__filename), '..', 'src', 'agents', 'skills');

const VALID_CATEGORIES = new Set(['always-on', 'on-demand', 'specialist-scope', 'archive']);
const VALID_SURFACES = new Set(['prompt', 'tool', 'both']);

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

function parseFrontmatter(content, filename) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const body = m[1];
  const fm = {};
  let lastKey = null;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (kv) {
      lastKey = kv[1];
      const val = kv[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        fm[lastKey] = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
      } else {
        fm[lastKey] = val;
      }
      continue;
    }
    if (lastKey && /^\s+\S/.test(line)) {
      fm[lastKey] = (fm[lastKey] ? fm[lastKey] + ' ' : '') + line.trim();
    }
  }
  return fm;
}

const files = readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md'));
check(`Found ${files.length} skill files`, files.length >= 20, `expected at least 20, got ${files.length}`);

const namesSeen = new Map();

for (const file of files) {
  const content = readFileSync(join(SKILLS_DIR, file), 'utf-8');
  const fm = parseFrontmatter(content, file);
  check(`${file}: has YAML frontmatter`, fm !== null);
  if (!fm) continue;

  check(`${file}: name field present`, !!fm.name, JSON.stringify(fm));
  check(`${file}: category field present`, !!fm.category);
  check(`${file}: surface field present`, !!fm.surface);
  check(`${file}: description field present`, !!fm.description);

  if (fm.category) {
    check(`${file}: category is valid (${fm.category})`, VALID_CATEGORIES.has(fm.category));
  }
  if (fm.surface) {
    check(`${file}: surface is valid (${fm.surface})`, VALID_SURFACES.has(fm.surface));
  }

  if (fm.category === 'on-demand') {
    check(`${file}: on-demand has keywords`, Array.isArray(fm.keywords) && fm.keywords.length > 0,
      `keywords=${JSON.stringify(fm.keywords)}`);
  } else {
    // keywords field optional for non-on-demand; if present, must still be a list
    if (fm.keywords !== undefined) {
      check(`${file}: keywords (if present on non-on-demand) is a list`, Array.isArray(fm.keywords));
    }
  }

  if (fm.name) {
    const dup = namesSeen.get(fm.name);
    check(`${file}: unique name "${fm.name}"`, !dup, dup ? `also in ${dup}` : '');
    namesSeen.set(fm.name, file);
  }

  if (fm.surface === 'tool' || fm.surface === 'both') {
    const hasEndpointsHeading = /^##\s+Endpoints\b/m.test(content);
    check(`${file}: surface=${fm.surface} requires "## Endpoints" heading`, hasEndpointsHeading,
      'audit T10 footgun guard — fix the heading or change surface');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
