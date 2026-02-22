/**
 * QuantumClaw Skill Loader
 *
 * Skills are markdown files. Drop one in, it works.
 * No manifests. No installation process. No version numbers.
 *
 * {{secrets.key}} auto-resolves from encrypted store.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { log } from '../core/logger.js';

export class SkillLoader {
  constructor(config) {
    this.config = config;
    this.skills = new Map();
  }

  async loadAll() {
    const agentsDir = join(this.config._dir, 'workspace', 'agents');
    if (!existsSync(agentsDir)) return 0;

    let total = 0;

    // Load skills from each agent's directory
    const agents = readdirSync(agentsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('_'));

    for (const agent of agents) {
      const skillsDir = join(agentsDir, agent.name, 'skills');
      if (!existsSync(skillsDir)) continue;

      const files = readdirSync(skillsDir).filter(f => f.endsWith('.md'));

      for (const file of files) {
        try {
          const content = readFileSync(join(skillsDir, file), 'utf-8');
          const skill = this._parse(file, content);
          this.skills.set(`${agent.name}/${skill.name}`, skill);
          total++;
        } catch (err) {
          log.warn(`Failed to load skill ${file}: ${err.message}`);
        }
      }
    }

    // Load shared skills
    const sharedDir = join(this.config._dir, 'workspace', 'shared', 'skills');
    if (existsSync(sharedDir)) {
      const files = readdirSync(sharedDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        try {
          const content = readFileSync(join(sharedDir, file), 'utf-8');
          const skill = this._parse(file, content);
          this.skills.set(`shared/${skill.name}`, skill);
          total++;
        } catch (err) {
          log.warn(`Failed to load shared skill ${file}: ${err.message}`);
        }
      }
    }

    return total;
  }

  get(key) {
    return this.skills.get(key);
  }

  list() {
    return Array.from(this.skills.values());
  }

  forAgent(agentName) {
    const result = [];
    for (const [key, skill] of this.skills) {
      if (key.startsWith(`${agentName}/`) || key.startsWith('shared/')) {
        result.push(skill);
      }
    }
    return result;
  }

  _parse(filename, content) {
    const skill = {
      name: filename.replace('.md', ''),
      raw: content,
      auth: null,
      baseUrl: null,
      endpoints: [],
      hasCode: false,
      code: null,
      permissions: { http: [], shell: false, file: false },
      source: null,
      reviewed: true // local skills are trusted by default
    };

    let section = null;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      // Section headers
      if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
        skill.name = trimmed.slice(2).trim();
        continue;
      }
      if (trimmed === '## Auth') { section = 'auth'; continue; }
      if (trimmed === '## Endpoints') { section = 'endpoints'; continue; }
      if (trimmed === '## Implementation') { section = 'implementation'; continue; }
      if (trimmed === '## Permissions') { section = 'permissions'; continue; }
      if (trimmed === '## Source') { section = 'source'; continue; }
      if (trimmed.startsWith('## ')) { section = null; continue; }

      // Parse sections
      switch (section) {
        case 'auth':
          if (trimmed.startsWith('Base URL:')) {
            skill.baseUrl = trimmed.split('Base URL:')[1].trim();
          }
          if (trimmed.startsWith('Header:')) {
            skill.auth = trimmed.split('Header:')[1].trim();
          }
          break;

        case 'endpoints':
          const match = trimmed.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s*[-–]?\s*(.*)/);
          if (match) {
            skill.endpoints.push({
              method: match[1],
              path: match[2],
              description: match[3] || ''
            });
          }
          break;

        case 'implementation':
          if (trimmed.startsWith('```')) {
            skill.hasCode = !skill.hasCode;
          } else if (skill.hasCode) {
            skill.code = (skill.code || '') + line + '\n';
          }
          break;

        case 'permissions':
          if (trimmed.startsWith('- http:')) {
            const domains = trimmed.match(/\[([^\]]+)\]/);
            if (domains) skill.permissions.http = domains[1].split(',').map(d => d.trim());
          }
          if (trimmed.includes('shell:') && !trimmed.includes('none')) {
            skill.permissions.shell = true;
          }
          if (trimmed.includes('file:') && !trimmed.includes('none')) {
            skill.permissions.file = true;
          }
          break;

        case 'source':
          if (trimmed.startsWith('Imported from')) {
            skill.source = trimmed;
            skill.reviewed = !trimmed.includes('Reviewed: false');
          }
          break;
      }
    }

    return skill;
  }
}
