#!/usr/bin/env node

/**
 * Regenerate KEYWORD_REFERENCE.md from skill frontmatter.
 *
 * Reads every .md in src/agents/skills/, parses YAML frontmatter
 * (fields: name, category, surface, keywords, description), and writes
 * KEYWORD_REFERENCE.md with the always-on table, the keyword → skill
 * routing table, combination triggers, hard-cap notes, and maintenance.
 *
 * Skills with category = specialist-scope or archive are excluded from
 * the keyword tables but still part of the canonical skill set.
 *
 * Usage:
 *   node scripts/regen-keyword-reference.js
 *
 * Idempotent. Safe to run repeatedly. The header on the regenerated file
 * marks it as not-hand-editable.
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), '..');
const SKILLS_DIR = join(REPO_ROOT, 'src', 'agents', 'skills');
const OUTPUT = join(REPO_ROOT, 'KEYWORD_REFERENCE.md');

const VALID_CATEGORIES = new Set(['always-on', 'on-demand', 'specialist-scope', 'archive']);
const VALID_SURFACES = new Set(['prompt', 'tool', 'both']);

// Combination triggers — kept here while only Emma+content exists.
// Promote to per-skill frontmatter or a config file when more emerge.
const COMBINATION_TRIGGERS = [
  {
    pattern: 'Emma + content / podcast / reel / Buzzsprout',
    skill: 'content-studio',
    note: 'Emma alone does NOT trigger — content keyword required.',
  },
  {
    pattern: 'community + GHL or specific portal name',
    skill: 'community-manager (variant by business unit context)',
    note: 'Routes to FSC vs Flow OS variant by context.',
  },
];

const HEADER = '<!-- GENERATED FROM SKILL FRONTMATTER — DO NOT EDIT BY HAND. Regenerate with: node scripts/regen-keyword-reference.js -->';

function parseFrontmatter(content, filename) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    throw new Error(`${filename}: no YAML frontmatter found`);
  }
  const body = m[1];
  const lines = body.split(/\r?\n/);
  const fm = {};
  let lastKey = null;
  for (const line of lines) {
    if (/^\s*#/.test(line)) continue; // YAML comment line
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (kv) {
      lastKey = kv[1];
      const val = kv[2].trim();
      if (val.startsWith('[') && val.endsWith(']')) {
        fm[lastKey] = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
      } else if (val === '>' || val === '|') {
        fm[lastKey] = '';
      } else if (val !== '') {
        fm[lastKey] = val;
      } else {
        fm[lastKey] = '';
      }
      continue;
    }
    if (lastKey && /^\s+\S/.test(line)) {
      fm[lastKey] = (fm[lastKey] ? fm[lastKey] + ' ' : '') + line.trim();
    }
  }
  return fm;
}

function loadSkills() {
  const files = readdirSync(SKILLS_DIR).filter(f => f.endsWith('.md')).sort();
  const skills = [];
  for (const file of files) {
    const content = readFileSync(join(SKILLS_DIR, file), 'utf-8');
    const fm = parseFrontmatter(content, file);
    if (!fm.name || !fm.category || !fm.surface) {
      throw new Error(`${file}: missing required frontmatter fields (name/category/surface)`);
    }
    if (!VALID_CATEGORIES.has(fm.category)) {
      throw new Error(`${file}: invalid category "${fm.category}"`);
    }
    if (!VALID_SURFACES.has(fm.surface)) {
      throw new Error(`${file}: invalid surface "${fm.surface}"`);
    }
    skills.push({
      file,
      name: fm.name,
      category: fm.category,
      surface: fm.surface,
      keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
      description: fm.description || '',
    });
  }
  return skills;
}

function buildAlwaysOnSection(skills) {
  const alwaysOn = skills.filter(s => s.category === 'always-on');
  const lines = [
    '## Always-on skills (always loaded, no keyword needed)',
    '',
    'These load on every prompt regardless of message content:',
    '',
  ];
  for (const s of alwaysOn) {
    const desc = s.description ? ` — ${s.description}` : '';
    lines.push(`- \`${s.name}.md\`${desc}`);
  }
  return lines.join('\n');
}

function buildOnDemandSection(skills) {
  const onDemand = skills.filter(s => s.category === 'on-demand');
  const lines = [
    '## On-demand skills (triggered by keywords)',
    '',
    '| Keyword(s) | Skill loaded |',
    '|---|---|',
  ];
  for (const s of onDemand) {
    if (!s.keywords.length) continue;
    lines.push(`| ${s.keywords.join(', ')} | \`${s.name}.md\` |`);
  }
  return lines.join('\n');
}

function buildCombinationSection() {
  const lines = [
    '## Combination triggers',
    '',
    'Some keywords are too ambiguous on their own. They only trigger skill loading when paired with a domain keyword:',
    '',
  ];
  for (const c of COMBINATION_TRIGGERS) {
    lines.push(`- **${c.pattern}** → \`${c.skill}\`${c.note ? ` _(${c.note})_` : ''}`);
  }
  return lines.join('\n');
}

const HARD_LIMITS = `## Hard limits

- Hard cap of 4 on-demand skills per prompt
- If more than 4 keywords match, top 4 by keyword density load
- Dropped skills logged in skill load log (\`~/.quantumclaw/skill-load.log\`)`;

const HOW_TO_USE = `## How to use this file

When you want Charlie to load a specific skill, include the trigger keyword in your message. Example:

- "Help me think through the Trading scanner heartbeat" → triggers \`trading.md\`
- "Audit the dashboard wiring" → triggers \`qa.md\` and \`build.md\`
- "Walk me through this n8n workflow" → triggers \`build.md\`

When you want Charlie to *not* load a skill, avoid the keyword. Example:

- Casual mention of Emma without content keywords → \`content-studio.md\` not loaded
- General "what's pending" question → no on-demand skills loaded`;

const MAINTENANCE = `## Maintenance

This file is generated from YAML frontmatter on each skill in \`src/agents/skills/\`. To change which skills are always-on or which keywords route to which skill, edit the skill's frontmatter and regenerate:

\`\`\`sh
node scripts/regen-keyword-reference.js
\`\`\`

The combination-trigger block at the top of the script is a small hardcoded list (currently Emma+content and community variants). When more combinations emerge they should migrate to a config file.

Frontmatter spec (per skill .md):

\`\`\`yaml
---
name: <slug>
category: always-on | on-demand | specialist-scope | archive
surface: prompt | tool | both
keywords: [k1, k2, ...]   # required iff category=on-demand
description: <one-line>
---
\`\`\``;

function render() {
  const skills = loadSkills();
  return [
    HEADER,
    '# Keyword Reference',
    '',
    'This is the cheat sheet for which keywords trigger which skills in Charlie\'s prompt assembly. It exists because keyword-based routing is brittle — Tyson uses this to be deliberate about loading the right skill into Charlie\'s context.',
    '',
    'This will be retired when intent classification replaces keyword routing (planned Phase 5+, after 2-4 weeks of routing telemetry).',
    '',
    buildAlwaysOnSection(skills),
    '',
    buildOnDemandSection(skills),
    '',
    buildCombinationSection(),
    '',
    HARD_LIMITS,
    '',
    HOW_TO_USE,
    '',
    MAINTENANCE,
    '',
  ].join('\n');
}

export function main() {
  const out = render();
  writeFileSync(OUTPUT, out);
  console.log(`Regenerated ${OUTPUT} from ${SKILLS_DIR}`);
}

// Only run when invoked as a CLI, not when imported (e.g. by smoke test).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
