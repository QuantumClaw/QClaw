/**
 * QuantumClaw — Knowledge Graph Engine
 *
 * A lightweight knowledge graph that runs in Node.js on any device.
 * Uses the LLM to extract entities and relationships from conversations,
 * stored in SQLite via @agexhq/store (sql.js on Termux, native on server).
 *
 * This is the default "brain" for QuantumClaw. It provides:
 * - Entity extraction (people, companies, projects, concepts)
 * - Relationship mapping (works-at, uses, built, knows, etc.)
 * - Graph traversal (find connections between entities)
 * - Context building (inject relevant graph context into prompts)
 *
 * For users who want deeper knowledge graph capabilities (vector embeddings,
 * graph databases, sophisticated pipelines), QuantumClaw can connect to a
 * Cognee instance running on a PC/server via HTTP.
 *
 * Zero native dependencies. Works on armv7l, armv8l, aarch64, x86_64.
 */

import { log } from '../core/logger.js';

export class KnowledgeGraph {
  constructor(db) {
    this.db = db; // from @agexhq/store or JSON fallback
    this._useJson = !db;
    this._entities = [];
    this._relationships = [];
  }

  init() {
    if (this.db) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS entities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'unknown',
          description TEXT,
          aliases TEXT DEFAULT '[]',
          mentions INTEGER DEFAULT 1,
          first_seen TEXT DEFAULT (datetime('now')),
          last_seen TEXT DEFAULT (datetime('now')),
          UNIQUE(name, type)
        );
        CREATE INDEX IF NOT EXISTS idx_entity_name ON entities(name);
        CREATE INDEX IF NOT EXISTS idx_entity_type ON entities(type);

        CREATE TABLE IF NOT EXISTS relationships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_id INTEGER NOT NULL,
          target_id INTEGER NOT NULL,
          relation TEXT NOT NULL,
          context TEXT,
          strength REAL DEFAULT 1.0,
          created TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (source_id) REFERENCES entities(id),
          FOREIGN KEY (target_id) REFERENCES entities(id)
        );
        CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
        CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);
      `);
    }
  }

  /**
   * Add or update an entity
   */
  upsertEntity(name, type = 'unknown', description = null) {
    if (!name || name.length < 2) return null;
    const normalised = name.trim().toLowerCase();

    if (this.db) {
      const existing = this.db.prepare(
        'SELECT id, mentions FROM entities WHERE LOWER(name) = ? AND type = ?'
      ).get(normalised, type);

      if (existing) {
        this.db.prepare(
          'UPDATE entities SET mentions = mentions + 1, last_seen = datetime(\'now\'), description = COALESCE(?, description) WHERE id = ?'
        ).run(description, existing.id);
        return existing.id;
      }

      const result = this.db.prepare(
        'INSERT INTO entities (name, type, description) VALUES (?, ?, ?)'
      ).run(name.trim(), type, description);
      return result.lastInsertRowid;
    }

    // JSON fallback
    const existing = this._entities.find(e => e.name.toLowerCase() === normalised && e.type === type);
    if (existing) {
      existing.mentions = (existing.mentions || 1) + 1;
      existing.last_seen = new Date().toISOString();
      if (description) existing.description = description;
      return existing.id;
    }
    const id = this._entities.length + 1;
    this._entities.push({ id, name: name.trim(), type, description, mentions: 1, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() });
    return id;
  }

  /**
   * Add a relationship between two entities
   */
  addRelationship(sourceId, targetId, relation, context = null) {
    if (!sourceId || !targetId || !relation) return;

    if (this.db) {
      // Check for existing relationship
      const existing = this.db.prepare(
        'SELECT id, strength FROM relationships WHERE source_id = ? AND target_id = ? AND relation = ?'
      ).get(sourceId, targetId, relation);

      if (existing) {
        this.db.prepare(
          'UPDATE relationships SET strength = strength + 0.5, context = COALESCE(?, context) WHERE id = ?'
        ).run(context, existing.id);
        return;
      }

      this.db.prepare(
        'INSERT INTO relationships (source_id, target_id, relation, context) VALUES (?, ?, ?, ?)'
      ).run(sourceId, targetId, relation, context);
    } else {
      this._relationships.push({ source_id: sourceId, target_id: targetId, relation, context, strength: 1.0 });
    }
  }

  /**
   * Find an entity by name (fuzzy)
   */
  findEntity(name) {
    if (!name) return null;
    const normalised = name.trim().toLowerCase();

    if (this.db) {
      return this.db.prepare(
        'SELECT * FROM entities WHERE LOWER(name) = ? OR aliases LIKE ? ORDER BY mentions DESC LIMIT 1'
      ).get(normalised, `%${normalised}%`);
    }
    return this._entities.find(e => e.name.toLowerCase() === normalised);
  }

  /**
   * Get all relationships for an entity (both directions)
   */
  getRelationships(entityId) {
    if (this.db) {
      const outgoing = this.db.prepare(`
        SELECT r.relation, r.context, r.strength, e.name as target_name, e.type as target_type
        FROM relationships r JOIN entities e ON r.target_id = e.id
        WHERE r.source_id = ? ORDER BY r.strength DESC
      `).all(entityId);

      const incoming = this.db.prepare(`
        SELECT r.relation, r.context, r.strength, e.name as source_name, e.type as source_type
        FROM relationships r JOIN entities e ON r.source_id = e.id
        WHERE r.target_id = ? ORDER BY r.strength DESC
      `).all(entityId);

      return { outgoing, incoming };
    }

    return {
      outgoing: this._relationships.filter(r => r.source_id === entityId),
      incoming: this._relationships.filter(r => r.target_id === entityId),
    };
  }

  /**
   * Search entities by name/description
   */
  searchEntities(query, limit = 10) {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];

    if (this.db) {
      const conditions = terms.map(() => '(LOWER(name) LIKE ? OR LOWER(description) LIKE ?)').join(' OR ');
      const params = terms.flatMap(t => [`%${t}%`, `%${t}%`]);
      return this.db.prepare(
        `SELECT * FROM entities WHERE ${conditions} ORDER BY mentions DESC LIMIT ?`
      ).all(...params, limit);
    }

    return this._entities
      .filter(e => terms.some(t => e.name.toLowerCase().includes(t) || (e.description || '').toLowerCase().includes(t)))
      .slice(0, limit);
  }

  /**
   * Build a graph context string for a query.
   * Finds relevant entities and their relationships, formats as text
   * that can be injected into the agent's system prompt.
   */
  buildGraphContext(query, maxTokens = 500) {
    const entities = this.searchEntities(query, 5);
    if (entities.length === 0) return '';

    const parts = ['## Knowledge Graph'];

    for (const entity of entities) {
      const rels = this.getRelationships(entity.id);
      const entityLabel = `${entity.name} (${entity.type})`;

      if (rels.outgoing.length > 0 || rels.incoming.length > 0) {
        parts.push(`\n${entityLabel}:`);
        for (const r of rels.outgoing.slice(0, 5)) {
          parts.push(`  → ${r.relation} → ${r.target_name}`);
        }
        for (const r of rels.incoming.slice(0, 5)) {
          parts.push(`  ← ${r.relation} ← ${r.source_name}`);
        }
      } else if (entity.description) {
        parts.push(`${entityLabel}: ${entity.description}`);
      }
    }

    const result = parts.join('\n');
    // Rough token estimate: ~4 chars per token
    if (result.length > maxTokens * 4) {
      return result.slice(0, maxTokens * 4) + '\n...';
    }
    return result;
  }

  /**
   * Stats for dashboard
   */
  stats() {
    if (this.db) {
      const entities = this.db.prepare('SELECT COUNT(*) as c FROM entities').get().c;
      const relationships = this.db.prepare('SELECT COUNT(*) as c FROM relationships').get().c;
      const types = this.db.prepare('SELECT type, COUNT(*) as c FROM entities GROUP BY type').all();
      return { entities, relationships, types };
    }
    return {
      entities: this._entities.length,
      relationships: this._relationships.length,
      types: [],
    };
  }
}

/**
 * Extract entities and relationships from a message using the LLM.
 * Runs async — doesn't block the response.
 *
 * Token cost: ~300 input + ~100 output = ~400 tokens per extraction
 */
export async function extractGraph(router, graph, message, role) {
  if (role !== 'user') return;
  if (message.length < 40) return;
  if (/^(hi|hey|hello|thanks|ok|bye|yes|no|cheers|ta)\b/i.test(message.trim())) return;

  try {
    const result = await router.complete([
      {
        role: 'system',
        content: `Extract entities and relationships from the user's message.

Output format (one per line):
ENTITY: name | type | brief description
REL: source_name | relation | target_name | context

Entity types: person, company, project, tool, concept, place, event
Relation types: works-at, uses, built, knows, manages, owns, part-of, related-to, wants, likes, dislikes

Rules:
- Only extract clear, explicit information
- Max 5 entities, 5 relationships per message
- Skip vague or implied connections
- If nothing to extract, output: NONE`
      },
      { role: 'user', content: message.slice(0, 1500) }
    ], {
      model: router.fast || router.primary,
      maxTokens: 200,
    });

    if (!result.content || result.content.includes('NONE')) return;

    // First pass: create entities
    const entityMap = {};
    for (const line of result.content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('ENTITY:')) {
        const parts = trimmed.slice(7).split('|').map(s => s.trim());
        if (parts.length >= 2) {
          const [name, type, description] = parts;
          const id = graph.upsertEntity(name, type || 'unknown', description || null);
          if (id) entityMap[name.toLowerCase()] = id;
        }
      }
    }

    // Second pass: create relationships
    for (const line of result.content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('REL:')) {
        const parts = trimmed.slice(4).split('|').map(s => s.trim());
        if (parts.length >= 3) {
          const [sourceName, relation, targetName, context] = parts;

          // Find or create entities referenced in relationships
          let sourceId = entityMap[sourceName.toLowerCase()];
          let targetId = entityMap[targetName.toLowerCase()];

          if (!sourceId) {
            const found = graph.findEntity(sourceName);
            sourceId = found?.id || graph.upsertEntity(sourceName, 'unknown');
          }
          if (!targetId) {
            const found = graph.findEntity(targetName);
            targetId = found?.id || graph.upsertEntity(targetName, 'unknown');
          }

          if (sourceId && targetId) {
            graph.addRelationship(sourceId, targetId, relation, context || null);
          }
        }
      }
    }
  } catch (err) {
    log.debug(`Graph extraction failed: ${err.message}`);
  }
}
