/**
 * QuantumClaw Skill Loader
 *
 * Skills are markdown files. Drop one in, it works.
 * {{secrets.key}} auto-resolves from encrypted store.
 *
 * Supports:
 *   - Local skills (per-agent + shared)
 *   - ClawHub install (fetch SKILL.md from clawhub.ai)
 *   - Reset (mark unreviewed) / Enable / Disable
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { log } from '../core/logger.js';

export class SkillLoader {
  constructor(config) {
    this.config = config;
    this.skills = new Map();
    this._sharedDir = join(this.config._dir, 'workspace', 'shared', 'skills');
    this._metaFile = join(this.config._dir, 'workspace', 'shared', 'skills-meta.json');
    this._meta = {}; // { skillKey: { reviewed, enabled, installedFrom, installedAt } }
  }

  async loadAll() {
    // Load metadata
    this._loadMeta();

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
          const key = `${agent.name}/${skill.name}`;
          skill._key = key;
          skill._file = join(skillsDir, file);

          // Apply persisted metadata
          const meta = this._meta[key];
          if (meta) {
            if (meta.reviewed === false) skill.reviewed = false;
            if (meta.enabled === false) skill.enabled = false;
            if (meta.source) skill.source = meta.source;
          }

          this.skills.set(key, skill);
          total++;
        } catch (err) {
          log.warn(`Failed to load skill ${file}: ${err.message}`);
        }
      }
    }

    // Load shared skills
    if (existsSync(this._sharedDir)) {
      const files = readdirSync(this._sharedDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        try {
          const content = readFileSync(join(this._sharedDir, file), 'utf-8');
          const skill = this._parse(file, content);
          const key = `shared/${skill.name}`;
          skill._key = key;
          skill._file = join(this._sharedDir, file);

          const meta = this._meta[key];
          if (meta) {
            if (meta.reviewed === false) skill.reviewed = false;
            if (meta.enabled === false) skill.enabled = false;
            if (meta.source) skill.source = meta.source;
          }

          this.skills.set(key, skill);
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
      if (skill.enabled === false) continue;
      if (key.startsWith(`${agentName}/`) || key.startsWith('shared/')) {
        result.push(skill);
      }
    }
    return result;
  }

  // ─── Skill Management ────────────────────────────────

  /**
   * Reset a skill to unreviewed state.
   */
  async reset(name) {
    const key = this._findKey(name);
    if (!key) throw new Error(`Skill "${name}" not found`);
    const skill = this.skills.get(key);
    skill.reviewed = false;
    this._setMeta(key, { reviewed: false });
    log.info(`Skill reset: ${key}`);
  }

  /**
   * Reset ALL skills to unreviewed state.
   */
  async resetAll() {
    for (const [key, skill] of this.skills) {
      skill.reviewed = false;
      this._setMeta(key, { reviewed: false });
    }
    log.info(`All ${this.skills.size} skills reset to unreviewed`);
  }

  /**
   * Install a skill from a URL (ClawHub zip or raw SKILL.md).
   * Saves to shared/skills/ so all agents can use it.
   */
  async install(urlOrSlug) {
    mkdirSync(this._sharedDir, { recursive: true });

    let url = urlOrSlug;
    let slug = null;

    // If it's not a URL, treat as a ClawHub slug
    if (!url.startsWith('http')) {
      slug = url.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      // ClawHub serves skill content at this URL pattern
      url = `https://clawhub.ai/skills/${encodeURIComponent(slug)}`;
    }

    log.info(`Installing skill from: ${url}`);

    // Fetch the skill
    let content;
    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'text/markdown, text/plain, */*' },
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });

      if (!res.ok) {
        // Try alternate URL patterns for ClawHub
        if (slug) {
          const altUrls = [
            `https://clawhub.ai/api/skills/${slug}/latest/download`,
            `https://clawhub.ai/skills/${slug}/raw`,
          ];
          let found = false;
          for (const alt of altUrls) {
            try {
              const altRes = await fetch(alt, {
                headers: { 'Accept': 'text/markdown, text/plain, */*' },
                signal: AbortSignal.timeout(10000),
                redirect: 'follow',
              });
              if (altRes.ok) {
                content = await altRes.text();
                found = true;
                break;
              }
            } catch { /* try next */ }
          }
          if (!found) throw new Error(`ClawHub returned ${res.status} for "${slug}". Check the skill name at clawhub.ai/skills`);
        } else {
          throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
        }
      } else {
        content = await res.text();
      }
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Download timed out (15s)');
      throw err;
    }

    if (!content || content.length < 10) {
      throw new Error('Downloaded content is empty or too small');
    }

    // If it's HTML (ClawHub page, not raw), try to extract SKILL.md content
    if (content.trim().startsWith('<!') || content.trim().startsWith('<html')) {
      // Try to find markdown content in the page
      const mdMatch = content.match(/```(?:markdown|md)?\n([\s\S]*?)```/);
      if (mdMatch) {
        content = mdMatch[1];
      } else {
        throw new Error('URL returned HTML, not a SKILL.md file. Try a direct link to the raw .md file.');
      }
    }

    // Parse it to validate
    const skill = this._parse(slug || 'downloaded', content);

    // Save to shared skills
    const filename = (skill.name || slug || 'skill').replace(/[^a-z0-9_-]/gi, '-').toLowerCase() + '.md';
    const destPath = join(this._sharedDir, filename);
    writeFileSync(destPath, content);

    // Register it
    const key = `shared/${skill.name}`;
    skill._key = key;
    skill._file = destPath;
    skill.reviewed = false; // Always unreviewed on install
    skill.source = `Installed from ${urlOrSlug}`;
    this.skills.set(key, skill);

    this._setMeta(key, {
      reviewed: false,
      enabled: true,
      source: skill.source,
      installedAt: new Date().toISOString(),
      installedFrom: urlOrSlug,
    });

    log.success(`Skill installed: ${skill.name} (${skill.endpoints.length} endpoints) → ${filename}`);

    return {
      name: skill.name,
      endpoints: skill.endpoints.length,
      hasCode: skill.hasCode,
      source: skill.source,
      file: filename,
    };
  }

  /**
   * Enable/disable a skill without deleting it.
   */
  setEnabled(name, enabled) {
    const key = this._findKey(name);
    if (!key) throw new Error(`Skill "${name}" not found`);
    const skill = this.skills.get(key);
    skill.enabled = enabled;
    this._setMeta(key, { enabled });
    log.info(`Skill ${enabled ? 'enabled' : 'disabled'}: ${key}`);
  }

  /**
   * Delete a skill file from disk.
   */
  async remove(name) {
    const key = this._findKey(name);
    if (!key) throw new Error(`Skill "${name}" not found`);
    const skill = this.skills.get(key);
    if (skill._file && existsSync(skill._file)) {
      unlinkSync(skill._file);
    }
    this.skills.delete(key);
    delete this._meta[key];
    this._saveMeta();
    log.info(`Skill removed: ${key}`);
  }

  // ─── Internal ────────────────────────────────────────

  _findKey(name) {
    // Exact match
    if (this.skills.has(name)) return name;
    // Search by skill name
    for (const [key, skill] of this.skills) {
      if (skill.name === name || key.endsWith('/' + name)) return key;
    }
    return null;
  }

  _loadMeta() {
    try {
      if (existsSync(this._metaFile)) {
        this._meta = JSON.parse(readFileSync(this._metaFile, 'utf-8'));
      }
    } catch { this._meta = {}; }
  }

  _setMeta(key, updates) {
    this._meta[key] = { ...(this._meta[key] || {}), ...updates };
    this._saveMeta();
  }

  _saveMeta() {
    try {
      const dir = join(this.config._dir, 'workspace', 'shared');
      mkdirSync(dir, { recursive: true });
      writeFileSync(this._metaFile, JSON.stringify(this._meta, null, 2));
    } catch (err) {
      log.debug(`Failed to save skills metadata: ${err.message}`);
    }
  }

  _parse(filename, content) {
    const skill = {
      name: filename.replace('.md', ''),
      description: '',
      raw: content,
      auth: null,
      baseUrl: null,
      endpoints: [],
      hasCode: false,
      code: null,
      permissions: { http: [], shell: false, file: false },
      source: 'local',
      reviewed: true, // local skills trusted by default
      enabled: true,
    };

    let section = null;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();

      // Section headers
      if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
        skill.name = trimmed.slice(2).trim();
        continue;
      }

      // YAML frontmatter (ClawHub format)
      if (trimmed.startsWith('description:')) {
        skill.description = trimmed.slice(12).trim().replace(/^["']|["']$/g, '');
        continue;
      }

      if (trimmed === '## Auth') { section = 'auth'; continue; }
      if (trimmed === '## Endpoints') { section = 'endpoints'; continue; }
      if (trimmed === '## Implementation') { section = 'implementation'; continue; }
      if (trimmed === '## Permissions') { section = 'permissions'; continue; }
      if (trimmed === '## Source') { section = 'source'; continue; }
      if (trimmed === '## Usage' || trimmed === '## Usage Instructions') { section = 'usage'; continue; }
      if (trimmed.startsWith('## ')) { section = null; continue; }

      // Grab first paragraph as description if not set
      if (!section && !skill.description && trimmed.length > 10 && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
        skill.description = trimmed.slice(0, 120);
        continue;
      }

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
