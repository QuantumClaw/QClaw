/**
 * QuantumClaw — Team Presets
 *
 * Built-in team templates that spawn multiple agents at once.
 * Users can also define custom presets in config.json under agents.teams.
 */

export const TEAM_PRESETS = {
  'Content Team': {
    description: 'Content creation workflow — research, write, edit',
    agents: [
      { name: 'writer', role: 'Draft blog posts, articles, social media content, and marketing copy from research and briefs', model_tier: 'standard', scopes: ['chat', 'web_search', 'search_knowledge'] },
      { name: 'editor', role: 'Review, proofread, and improve written content for clarity, tone, grammar, and SEO', model_tier: 'simple', scopes: ['chat', 'search_knowledge'] },
      { name: 'seo-specialist', role: 'Research keywords, analyse search intent, optimise content for search rankings', model_tier: 'simple', scopes: ['chat', 'web_search'] },
    ]
  },
  'Dev Team': {
    description: 'Software development workflow — design, build, review',
    agents: [
      { name: 'architect', role: 'Design system architecture, plan features, make technical decisions, review code quality', model_tier: 'complex', scopes: ['chat', 'web_search', 'search_knowledge', 'read_file'] },
      { name: 'coder', role: 'Write code, implement features, fix bugs, refactor', model_tier: 'standard', scopes: ['chat', 'shell_exec', 'read_file', 'write_file', 'search_knowledge'] },
      { name: 'reviewer', role: 'Review code changes, check for bugs, suggest improvements, verify tests pass', model_tier: 'simple', scopes: ['chat', 'shell_exec', 'read_file'] },
    ]
  },
  'Research Team': {
    description: 'Deep research and analysis workflow — gather, analyse, report',
    agents: [
      { name: 'scout', role: 'Search the web and gather raw information, sources, and data on a topic', model_tier: 'simple', scopes: ['chat', 'web_search', 'web_fetch'] },
      { name: 'analyst', role: 'Analyse gathered data, identify patterns, draw conclusions, fact-check claims', model_tier: 'complex', scopes: ['chat', 'search_knowledge', 'web_search'] },
      { name: 'reporter', role: 'Synthesise analysis into clear, structured reports and executive summaries', model_tier: 'standard', scopes: ['chat', 'search_knowledge'] },
    ]
  },
};

export function getPreset(name) {
  // Case-insensitive lookup
  const key = Object.keys(TEAM_PRESETS).find(k => k.toLowerCase() === name.toLowerCase());
  return key ? { name: key, ...TEAM_PRESETS[key] } : null;
}

export function listPresets() {
  return Object.entries(TEAM_PRESETS).map(([name, preset]) => ({
    name,
    description: preset.description,
    agentCount: preset.agents.length,
    agents: preset.agents.map(a => a.name),
  }));
}
