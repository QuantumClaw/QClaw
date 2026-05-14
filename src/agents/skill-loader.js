/**
 * QuantumClaw Skill Loader (Slice 2b Task 4)
 *
 * loadSkills(context) — agent-level skill loader. Reads canonical skills
 * from /root/QClaw/src/agents/skills/, partitions by frontmatter category,
 * routes on-demand candidates against the user message via skill-router,
 * applies hard-cap-4, returns SkillLoadResult.
 *
 * NOT to be confused with the deleted src/skills/loader.js (the global
 * SkillLoader retired in Slice 2a). This is the agent-level loader that
 * the bootstrap-aware _buildSystemPrompt consumes per message.
 *
 * Tool registration is OUT OF SCOPE for this loader — that stays in
 * Agent.load() per audit T7, deferred to Slice 3 (tool surface overhaul).
 *
 * Caching: always-on portion is session-stable. When context.bootstrap
 * is passed, reuse bootstrap.skills.always_on if present (Layer 6 wired
 * in Task 8). On-demand portion is per-message — never cached.
 */

import { readdirSync, readFileSync, existsSync, appendFileSync, chmodSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { log } from '../core/logger.js';
import { routeKeywords } from './skill-router.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), '..', '..');
const SKILLS_DIR = join(REPO_ROOT, 'src', 'agents', 'skills');

// Tests override via QCLAW_SKILL_LOG_PATH so they don't pollute the real log.
function _logPath() {
  return process.env.QCLAW_SKILL_LOG_PATH || join(homedir(), '.quantumclaw', 'skill-load.log');
}

const HARD_CAP_ON_DEMAND = 4;
const TOKEN_CHARS_PER_TOKEN = 4; // standard rough estimate

/**
 * @typedef {Object} ParsedSkill
 * @property {string} name
 * @property {string} category
 * @property {string} surface
 * @property {string[]} keywords
 * @property {string} description
 * @property {string} content        // full file content (incl. frontmatter)
 * @property {string} filename
 */

/**
 * @typedef {Object} SkillLoadResult
 * @property {Array<{name, content, frontmatter}>} always_on
 * @property {Array<{name, content, frontmatter, matched_keywords, density}>} on_demand
 * @property {Array<{name, reason, matched_keywords?, density?}>} considered_but_dropped
 * @property {number} total_token_estimate
 * @property {{always_on: string[], on_demand: string[], always_on_skill_names: string[], on_demand_skill_names: string[]}} tools
 *   Slice 3b: tool-ownership rollup. `always_on` and `on_demand` are the
 *   explicit tool-name lists collected from each loaded skill's
 *   frontmatter `tools:` field. `always_on_skill_names` and
 *   `on_demand_skill_names` carry the skill names themselves so the
 *   ToolRegistry can apply skill-prefix-implicit ownership (any tool
 *   named `<agent>__<skill>__*` or `<skill>__*` is implicitly owned by
 *   that skill). The registry combines explicit + implicit + 'shared'
 *   scope to compute the per-request active set.
 */

/**
 * Minimal YAML frontmatter parser. Same shape as the regen script —
 * limited to the fields we use, no full YAML.
 */
function parseFrontmatter(content) {
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

/**
 * Read all skills from canonical SSOT. Skip archive/ subdirectory.
 * Skills with missing required frontmatter fields are skipped with a
 * warning — they don't bring the loader down.
 *
 * @returns {ParsedSkill[]}
 */
function readAllSkills() {
  if (!existsSync(SKILLS_DIR)) {
    log.warn(`skill-loader: ${SKILLS_DIR} does not exist`);
    return [];
  }
  const skills = [];
  for (const file of readdirSync(SKILLS_DIR)) {
    if (!file.endsWith('.md')) continue; // skips archive/ dir + .gitkeep
    const filepath = join(SKILLS_DIR, file);
    let content;
    try {
      content = readFileSync(filepath, 'utf-8');
    } catch (err) {
      log.warn(`skill-loader: failed to read ${file}: ${err.message}`);
      continue;
    }
    const fm = parseFrontmatter(content);
    if (!fm || !fm.name || !fm.category || !fm.surface) {
      log.warn(`skill-loader: ${file} missing required frontmatter (name/category/surface)`);
      continue;
    }
    skills.push({
      name: fm.name,
      category: fm.category,
      surface: fm.surface,
      keywords: Array.isArray(fm.keywords) ? fm.keywords : [],
      tools: Array.isArray(fm.tools) ? fm.tools : [],
      description: fm.description || '',
      content,
      filename: file,
    });
  }
  return skills;
}

/**
 * Append one JSON-line entry to ~/.quantumclaw/skill-load.log.
 * Mode 0600 enforced on creation. Failure is non-fatal — log warn,
 * continue.
 */
function writeLogEntry(entry) {
  const path = _logPath();
  try {
    const line = JSON.stringify(entry) + '\n';
    appendFileSync(path, line);
    // Ensure 0600 on first write (idempotent — chmod is cheap)
    try {
      const mode = statSync(path).mode & 0o777;
      if (mode !== 0o600) chmodSync(path, 0o600);
    } catch { /* file readable, mode check is best-effort */ }
  } catch (err) {
    log.warn(`skill-loader: skill-load.log write failed: ${err.message}`);
  }
}

/**
 * @param {Object} context
 * @param {string} context.agent              agent name (currently only 'charlie')
 * @param {string} context.message            incoming user message text
 * @param {Object} [context.bootstrap]        optional bootstrap result for layer-6 reuse
 * @param {string|number} [context.userId]    surfaced into skill-load.log for traceability
 * @returns {Promise<SkillLoadResult>}
 */
export async function loadSkills(context = {}) {
  const message = typeof context.message === 'string' ? context.message : '';
  const agentName = context.agent || 'charlie';

  // 1. Source skills — reuse bootstrap.skills.always_on if present (cache-stable),
  //    re-read on-demand candidates fresh per message.
  const cachedAlwaysOn = context.bootstrap?.skills?.always_on;
  const allSkills = readAllSkills();

  // 2. Partition by category.
  const alwaysOnSkills = allSkills.filter(s => s.category === 'always-on');
  const onDemandSkills = allSkills.filter(s => s.category === 'on-demand');
  // specialist-scope and archive are excluded from Charlie's prompt entirely.

  // 3. Build always_on output (reuse bootstrap cache if present).
  const always_on = (cachedAlwaysOn && Array.isArray(cachedAlwaysOn) && cachedAlwaysOn.length > 0)
    ? cachedAlwaysOn
    : alwaysOnSkills.map(s => ({
        name: s.name,
        content: s.content,
        frontmatter: { category: s.category, surface: s.surface, description: s.description, tools: s.tools },
      }));

  // 4. Route on-demand candidates against message.
  const matches = routeKeywords(message, onDemandSkills);

  // 5. Apply hard-cap-4. Top 4 by density → on_demand. Remainder → dropped.
  const top = matches.slice(0, HARD_CAP_ON_DEMAND);
  const dropped = matches.slice(HARD_CAP_ON_DEMAND);

  const skillByName = new Map(onDemandSkills.map(s => [s.name, s]));

  const on_demand = top.map(m => {
    const skill = skillByName.get(m.name);
    return {
      name: m.name,
      content: skill.content,
      frontmatter: { category: skill.category, surface: skill.surface, description: skill.description, tools: skill.tools },
      matched_keywords: m.matched_keywords,
      density: m.density,
    };
  });

  const considered_but_dropped = dropped.map(m => ({
    name: m.name,
    reason: 'hard-cap-4',
    matched_keywords: m.matched_keywords,
    density: m.density,
  }));

  // 5b. Slice 3b — tool-ownership rollup. Two-part shape: explicit tool
  // names declared in frontmatter, plus the skill names so the registry
  // can resolve skill-prefix-implicit ownership (<agent>__<skill>__*).
  const toolsFromFrontmatter = (skill) => Array.isArray(skill?.frontmatter?.tools)
    ? skill.frontmatter.tools.filter(t => typeof t === 'string' && t.length > 0)
    : [];
  const tools = {
    always_on: always_on.flatMap(toolsFromFrontmatter),
    on_demand: on_demand.flatMap(toolsFromFrontmatter),
    always_on_skill_names: always_on.map(s => s.name),
    on_demand_skill_names: on_demand.map(s => s.name),
  };

  // 6. Token estimate.
  const totalChars = always_on.reduce((sum, s) => sum + s.content.length, 0)
    + on_demand.reduce((sum, s) => sum + s.content.length, 0);
  const total_token_estimate = Math.ceil(totalChars / TOKEN_CHARS_PER_TOKEN);

  // 7. Write log entry (best-effort).
  writeLogEntry({
    ts: new Date().toISOString(),
    userId: context.userId !== undefined ? String(context.userId) : null,
    agentName,
    message_chars: message.length,
    always_on: always_on.map(s => s.name),
    on_demand: on_demand.map(s => ({ name: s.name, matched: s.matched_keywords, density: s.density })),
    dropped: considered_but_dropped.map(s => ({ name: s.name, reason: s.reason, density: s.density })),
    tools_declared: { always_on: tools.always_on, on_demand: tools.on_demand },
    total_chars: totalChars,
  });

  return {
    always_on,
    on_demand,
    considered_but_dropped,
    total_token_estimate,
    tools,
  };
}
