/**
 * QuantumClaw — Knowledge Store
 *
 * Structured long-term memory modelled on human memory types.
 * Extracts knowledge from conversations and stores it efficiently
 * so the agent doesn't burn tokens re-reading raw chat history.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  MEMORY TYPE          │ WHAT IT STORES      │ LIFESPAN  │
 * ├───────────────────────┼─────────────────────┼───────────┤
 * │  Working Memory       │ Current conversation │ Session   │
 * │  Episodic Memory      │ Key events/moments   │ Long-term │
 * │  Semantic Memory      │ Facts about user     │ Permanent │
 * │  Procedural Memory    │ How user likes things│ Permanent │
 * └─────────────────────────────────────────────────────────┘
 *
 * Working Memory  = last N messages (already handled by getHistory())
 * Episodic Memory = timestamped events: "User closed deal with X on Jan 5"
 * Semantic Memory = facts: "User's business is ALLIN1.APP", "Main CRM is GHL"
 * Procedural      = preferences: "User prefers brief responses", "Hates bullet points"
 *
 * Token budget for knowledge injection:
 *   Semantic:   ~500 tokens  (core facts, always loaded)
 *   Procedural: ~200 tokens  (preferences, always loaded)
 *   Episodic:   ~300 tokens  (relevant events via search, loaded on demand)
 *   Total:      ~1,000 tokens — vs 5,000+ tokens for 20 raw messages
 *
 * Storage: SQLite table `knowledge` (or JSON fallback on Termux)
 * Extraction: LLM-based, runs async after each conversation turn
 * Zero native dependencies. Works everywhere.
 */

import { log } from '../core/logger.js';

// Memory types
const SEMANTIC = 'semantic';      // Facts about user/business
const EPISODIC = 'episodic';      // Timestamped events
const PROCEDURAL = 'procedural';  // Preferences and habits

// Limits per type (prevents unbounded growth)
const MAX_ENTRIES = {
  [SEMANTIC]: 100,    // 100 facts about the user — plenty
  [EPISODIC]: 200,    // 200 events — auto-prunes oldest
  [PROCEDURAL]: 50,   // 50 preferences
};

// Approximate tokens per entry (for budget calculations)
const AVG_TOKENS_PER_ENTRY = 15;

export class KnowledgeStore {
  constructor(db, jsonStore) {
    this.db = db;             // SQLite database (null on Termux)
    this._jsonStore = jsonStore; // JSON fallback store
  }

  /**
   * Initialise the knowledge tables/structure
   */
  init() {
    if (this.db) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS knowledge (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          confidence REAL DEFAULT 1.0,
          source TEXT DEFAULT 'conversation',
          created TEXT DEFAULT (datetime('now')),
          updated TEXT DEFAULT (datetime('now')),
          accessed INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge(type);
      `);
    } else if (this._jsonStore) {
      if (!this._jsonStore.knowledge) {
        this._jsonStore.knowledge = [];
      }
    }
  }

  /**
   * Add a knowledge entry. Deduplicates by checking for similar existing entries.
   */
  add(type, content, options = {}) {
    if (!content || content.length < 3) return;

    const entry = {
      type,
      content: content.trim().slice(0, 500), // cap entry length
      confidence: options.confidence ?? 1.0,
      source: options.source || 'conversation',
    };

    if (this.db) {
      // Check for duplicate (fuzzy — same first 50 chars of same type)
      const prefix = entry.content.slice(0, 50);
      const existing = this.db.prepare(
        'SELECT id, content FROM knowledge WHERE type = ? AND content LIKE ? LIMIT 1'
      ).get(type, prefix + '%');

      if (existing) {
        // Update existing entry (newer info wins)
        this.db.prepare(
          'UPDATE knowledge SET content = ?, confidence = ?, updated = datetime(\'now\') WHERE id = ?'
        ).run(entry.content, entry.confidence, existing.id);
        return existing.id;
      }

      // Enforce max entries per type
      const count = this.db.prepare('SELECT COUNT(*) as c FROM knowledge WHERE type = ?').get(type).c;
      if (count >= (MAX_ENTRIES[type] || 100)) {
        // Delete oldest, least-accessed entry
        this.db.prepare(
          'DELETE FROM knowledge WHERE id = (SELECT id FROM knowledge WHERE type = ? ORDER BY accessed ASC, updated ASC LIMIT 1)'
        ).run(type);
      }

      const result = this.db.prepare(
        'INSERT INTO knowledge (type, content, confidence, source) VALUES (?, ?, ?, ?)'
      ).run(entry.type, entry.content, entry.confidence, entry.source);

      return result.lastInsertRowid;
    }

    if (this._jsonStore) {
      const knowledge = this._jsonStore.knowledge;

      // Deduplicate
      const prefix = entry.content.slice(0, 50);
      const existingIdx = knowledge.findIndex(k => k.type === type && k.content.startsWith(prefix));
      if (existingIdx !== -1) {
        knowledge[existingIdx] = { ...knowledge[existingIdx], ...entry, updated: new Date().toISOString() };
        return;
      }

      // Enforce max entries per type
      const typeEntries = knowledge.filter(k => k.type === type);
      if (typeEntries.length >= (MAX_ENTRIES[type] || 100)) {
        // Remove oldest of this type
        const oldestIdx = knowledge.findIndex(k => k.type === type);
        if (oldestIdx !== -1) knowledge.splice(oldestIdx, 1);
      }

      knowledge.push({
        ...entry,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        accessed: 0,
      });
    }
  }

  /**
   * Get all entries of a given type
   */
  getByType(type, limit = 50) {
    if (this.db) {
      const rows = this.db.prepare(
        'SELECT id, content, confidence, source, created, updated FROM knowledge WHERE type = ? ORDER BY confidence DESC, updated DESC LIMIT ?'
      ).all(type, limit);

      // Mark as accessed (for pruning priority)
      if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        this.db.prepare(
          `UPDATE knowledge SET accessed = accessed + 1 WHERE id IN (${ids.join(',')})`
        ).run();
      }

      return rows;
    }

    if (this._jsonStore) {
      return (this._jsonStore.knowledge || [])
        .filter(k => k.type === type)
        .sort((a, b) => (b.confidence || 1) - (a.confidence || 1))
        .slice(0, limit);
    }

    return [];
  }

  /**
   * Search across all knowledge types
   */
  search(query, limit = 10) {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];

    if (this.db) {
      // SQLite LIKE search (good enough for <350 entries)
      const conditions = terms.map(() => 'content LIKE ?').join(' OR ');
      const params = terms.map(t => `%${t}%`);
      return this.db.prepare(
        `SELECT type, content, confidence FROM knowledge WHERE ${conditions} ORDER BY confidence DESC LIMIT ?`
      ).all(...params, limit);
    }

    if (this._jsonStore) {
      return (this._jsonStore.knowledge || [])
        .filter(k => terms.some(t => k.content.toLowerCase().includes(t)))
        .sort((a, b) => (b.confidence || 1) - (a.confidence || 1))
        .slice(0, limit);
    }

    return [];
  }

  /**
   * Build a condensed context string for the agent's system prompt.
   * This is the key method — replaces loading 20 raw messages with
   * a tight summary of what the agent knows about the user.
   *
   * Target: ~1,000 tokens total (vs 5,000+ for raw history)
   */
  buildContext() {
    const parts = [];

    // Semantic memory — core facts (always loaded, ~500 tokens)
    const facts = this.getByType(SEMANTIC, 30);
    if (facts.length > 0) {
      parts.push('## What I Know About You');
      for (const f of facts) {
        parts.push(`- ${f.content}`);
      }
    }

    // Procedural memory — preferences (always loaded, ~200 tokens)
    const prefs = this.getByType(PROCEDURAL, 20);
    if (prefs.length > 0) {
      parts.push('\n## Your Preferences');
      for (const p of prefs) {
        parts.push(`- ${p.content}`);
      }
    }

    // Episodic memory — recent events only (~300 tokens)
    const events = this.getByType(EPISODIC, 10);
    if (events.length > 0) {
      parts.push('\n## Recent Events');
      for (const e of events) {
        const date = e.created ? new Date(e.created).toLocaleDateString('en-GB', { month: 'short', day: 'numeric' }) : '';
        parts.push(`- ${date ? date + ': ' : ''}${e.content}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Get statistics about stored knowledge
   */
  stats() {
    const count = (type) => {
      if (this.db) {
        return this.db.prepare('SELECT COUNT(*) as c FROM knowledge WHERE type = ?').get(type).c;
      }
      if (this._jsonStore) {
        return (this._jsonStore.knowledge || []).filter(k => k.type === type).length;
      }
      return 0;
    };

    return {
      semantic: count(SEMANTIC),
      episodic: count(EPISODIC),
      procedural: count(PROCEDURAL),
      total: count(SEMANTIC) + count(EPISODIC) + count(PROCEDURAL),
      estimatedTokens: (count(SEMANTIC) + count(EPISODIC) + count(PROCEDURAL)) * AVG_TOKENS_PER_ENTRY,
    };
  }

  /**
   * Remove a specific entry
   */
  remove(id) {
    if (this.db) {
      this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
    }
    if (this._jsonStore) {
      this._jsonStore.knowledge = (this._jsonStore.knowledge || []).filter((_, i) => i !== id);
    }
  }

  /**
   * Clear all knowledge of a given type
   */
  clear(type) {
    if (this.db) {
      this.db.prepare('DELETE FROM knowledge WHERE type = ?').run(type);
    }
    if (this._jsonStore) {
      this._jsonStore.knowledge = (this._jsonStore.knowledge || []).filter(k => k.type !== type);
    }
  }
}

/**
 * Extract knowledge from a conversation message using the LLM.
 * Runs async — doesn't block the response.
 *
 * The extraction prompt is carefully designed to:
 * 1. Only extract NEW information (not repeat what's known)
 * 2. Classify into semantic/episodic/procedural
 * 3. Be extremely concise (one line per fact)
 * 4. Cost near-zero (uses fast model, short prompt, short response)
 *
 * Token cost per extraction: ~200 input + ~50 output = ~250 tokens
 * At Groq free tier: £0.00. At Claude Haiku: £0.0001.
 */
export async function extractKnowledge(router, knowledgeStore, message, role) {
  // Only extract from user messages (agent messages don't contain user knowledge)
  if (role !== 'user') return;

  // Skip trivial messages
  if (message.length < 30) return;
  if (/^(hi|hey|hello|thanks|ok|bye|yes|no|cheers|ta)\b/i.test(message.trim())) return;

  // Get existing knowledge to avoid duplicates
  const existing = knowledgeStore.buildContext();
  const existingSnippet = existing.slice(0, 800); // cap to save tokens

  try {
    const result = await router.complete([
      {
        role: 'system',
        content: `You extract knowledge from user messages. Output ONLY new facts not already known. Each line must start with exactly one of: FACT: PREF: EVENT:

FACT: = permanent fact about user/business (semantic memory)
PREF: = preference or habit (procedural memory)  
EVENT: = something that happened with a date/time context (episodic memory)

Rules:
- One fact per line, max 15 words each
- Only NEW information not in "Already Known"
- Skip greetings, filler, questions to the agent
- If nothing new, output: NONE

Already Known:
${existingSnippet || '(nothing yet)'}` 
      },
      { role: 'user', content: message.slice(0, 1000) } // cap input
    ], {
      model: router.fast || router.primary,
      maxTokens: 150,
    });

    if (!result.content || result.content.includes('NONE')) return;

    // Parse the response
    for (const line of result.content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('FACT:')) {
        knowledgeStore.add(SEMANTIC, trimmed.slice(5).trim());
      } else if (trimmed.startsWith('PREF:')) {
        knowledgeStore.add(PROCEDURAL, trimmed.slice(5).trim());
      } else if (trimmed.startsWith('EVENT:')) {
        knowledgeStore.add(EPISODIC, trimmed.slice(6).trim());
      }
    }
  } catch (err) {
    log.debug(`Knowledge extraction failed: ${err.message}`);
  }
}

export { SEMANTIC, EPISODIC, PROCEDURAL };
