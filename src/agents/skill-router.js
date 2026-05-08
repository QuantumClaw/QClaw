/**
 * QuantumClaw Skill Router (Slice 2b Task 5)
 *
 * Token-level keyword matching against a candidate pool of on-demand
 * skills. Returns matches sorted by density desc, then by skill name asc
 * for stable ordering.
 *
 * Brittleness is a known trade-off (audit §5(c)). LLM-driven router is
 * the Phase 5+ replacement behind the same loadSkills() interface.
 */

/**
 * Combination triggers — keyword-only matches that require an additional
 * disambiguating token in the message before the skill loads.
 *
 * Currently hardcoded (per brief). If more combinations emerge, migrate
 * to a `combination_required: [...]` field in skill frontmatter.
 *
 * Shape: {
 *   skill: string,                           // skill name to filter
 *   trigger_keywords: Set<string>,           // if any of these matched
 *   require_any_of: Set<string>,             // require any of these in message tokens
 * }
 */
const COMBINATION_TRIGGERS = [
  {
    skill: 'content-studio',
    trigger_keywords: new Set(['content', 'podcast', 'reel', 'buzzsprout']),
    require_any_of: new Set(['emma']),
  },
];

/**
 * Tokenize a string into lowercase alphanumeric tokens.
 * Punctuation runs become whitespace. Multi-character separators
 * (hyphens, dots, slashes) split into multiple tokens.
 *
 * Examples:
 *   "build a thing"            → ["build", "a", "thing"]
 *   "portal.flowos.tech"       → ["portal", "flowos", "tech"]
 *   "rebuilding the system"    → ["rebuilding", "the", "system"]
 *   ""                         → []
 *
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Does this keyword match the given message token set?
 *
 * Single-word keywords match if the keyword (post-tokenize) is in
 * the message tokens. Multi-word keywords (e.g. "portal-flowos") match
 * if ALL their constituent tokens are in the message tokens.
 *
 * @param {string} keyword
 * @param {Set<string>} messageTokens
 * @returns {boolean}
 */
function keywordMatches(keyword, messageTokens) {
  const keywordTokens = tokenize(keyword);
  if (keywordTokens.length === 0) return false;
  return keywordTokens.every(t => messageTokens.has(t));
}

/**
 * Apply combination triggers. A skill that matched only via "weak"
 * trigger keywords gets dropped if the disambiguator tokens aren't
 * also in the message.
 *
 * @param {string} skillName
 * @param {string[]} matchedKeywords
 * @param {Set<string>} messageTokens
 * @returns {boolean}  true if match passes; false if combination filter drops it
 */
function passesCombinationFilter(skillName, matchedKeywords, messageTokens) {
  const rule = COMBINATION_TRIGGERS.find(r => r.skill === skillName);
  if (!rule) return true;

  const onlyMatchedViaTriggers = matchedKeywords.every(k => rule.trigger_keywords.has(k));
  if (!onlyMatchedViaTriggers) return true;

  // All matches were trigger keywords — require a disambiguator
  for (const required of rule.require_any_of) {
    if (messageTokens.has(required)) return true;
  }
  return false;
}

/**
 * @typedef {Object} RouteMatch
 * @property {string}   name              skill name
 * @property {string[]} matched_keywords  keywords from the skill that matched
 * @property {number}   density           matched_keywords.length / messageTokenCount
 */

/**
 * Route message text against on-demand skill candidates.
 *
 * @param {string} message
 * @param {Array<{name: string, keywords: string[]}>} candidates
 * @returns {RouteMatch[]}  matches with density > 0, sorted by density desc, name asc
 */
export function routeKeywords(message, candidates) {
  const tokens = tokenize(message);
  if (tokens.length === 0) return [];
  const tokenSet = new Set(tokens);

  const matches = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate.keywords) || candidate.keywords.length === 0) continue;

    const matchedKeywords = candidate.keywords.filter(kw => keywordMatches(kw, tokenSet));
    if (matchedKeywords.length === 0) continue;

    if (!passesCombinationFilter(candidate.name, matchedKeywords, tokenSet)) continue;

    const density = matchedKeywords.length / tokens.length;
    matches.push({
      name: candidate.name,
      matched_keywords: matchedKeywords,
      density,
    });
  }

  matches.sort((a, b) => {
    if (b.density !== a.density) return b.density - a.density;
    return a.name.localeCompare(b.name);
  });

  return matches;
}
