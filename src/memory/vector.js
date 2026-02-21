/**
 * QuantumClaw — Vector Memory (Pure Node.js)
 *
 * Lightweight vector search for environments where Cognee can't run
 * (Termux/Android, no Docker, no Python wheels for lancedb).
 *
 * Three retrieval strategies:
 *   1. Embedding search (if an LLM API is available for embeddings)
 *   2. TF-IDF keyword search (always works, no API needed)
 *   3. Recency (newest first)
 *
 * Storage: JSON file in ~/.quantumclaw/vectors.json
 * No native dependencies. No Python. No compilation.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { log } from '../core/logger.js';

export class VectorMemory {
  constructor(config, secrets) {
    this.config = config;
    this.secrets = secrets;
    this.storePath = join(config._dir, 'vectors.json');
    this.documents = [];  // { id, text, embedding, metadata, timestamp }
    this.idfCache = null;
    this._dirty = false;
    this._saveTimer = null;
    this._embeddingProvider = null;
  }

  async init() {
    // Load existing store
    if (existsSync(this.storePath)) {
      try {
        this.documents = JSON.parse(readFileSync(this.storePath, 'utf-8'));
        log.debug(`VectorMemory: loaded ${this.documents.length} documents`);
      } catch {
        this.documents = [];
      }
    }

    // Detect embedding provider
    this._embeddingProvider = await this._detectEmbeddingProvider();
    if (this._embeddingProvider) {
      log.debug(`VectorMemory: using ${this._embeddingProvider.name} for embeddings`);
    } else {
      log.debug('VectorMemory: no embedding API — using TF-IDF keyword search');
    }

    // Auto-save every 30s if dirty
    this._saveTimer = setInterval(() => this._flush(), 30000);
    this._saveTimer.unref();

    return { documents: this.documents.length, provider: this._embeddingProvider?.name || 'tfidf' };
  }

  /**
   * Add a document to memory
   */
  async add(text, metadata = {}) {
    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const doc = {
      id,
      text: text.slice(0, 10000), // cap at 10k chars
      embedding: null,
      metadata,
      timestamp: Date.now(),
    };

    // Generate embedding if provider available
    if (this._embeddingProvider) {
      try {
        doc.embedding = await this._embed(text);
      } catch (err) {
        log.debug(`VectorMemory: embedding failed: ${err.message}`);
      }
    }

    // Generate TF-IDF tokens (always, as fallback)
    doc._tokens = this._tokenize(text);

    this.documents.push(doc);
    this._dirty = true;
    this.idfCache = null; // invalidate

    // Prune if over limit (keep most recent 5000)
    if (this.documents.length > 5000) {
      this.documents = this.documents.slice(-5000);
    }

    return id;
  }

  /**
   * Search for similar documents
   */
  async search(query, limit = 5) {
    if (this.documents.length === 0) return [];

    let results;

    // Try embedding search first
    if (this._embeddingProvider) {
      try {
        const queryEmb = await this._embed(query);
        results = this._cosineSimilaritySearch(queryEmb, limit);
        if (results.length > 0) return results;
      } catch {
        // Fall through to TF-IDF
      }
    }

    // TF-IDF keyword search
    results = this._tfidfSearch(query, limit);
    return results;
  }

  /**
   * Get recent documents (for conversation context)
   */
  recent(limit = 10) {
    return this.documents
      .slice(-limit)
      .reverse()
      .map(d => ({ id: d.id, text: d.text, metadata: d.metadata, timestamp: d.timestamp }));
  }

  /**
   * Get stats
   */
  stats() {
    const hasEmbeddings = this.documents.filter(d => d.embedding).length;
    return {
      total: this.documents.length,
      withEmbeddings: hasEmbeddings,
      provider: this._embeddingProvider?.name || 'tfidf',
      storePath: this.storePath,
    };
  }

  async disconnect() {
    this._flush();
    if (this._saveTimer) clearInterval(this._saveTimer);
  }

  // ─── Embedding Providers ───────────────────────────────────

  async _detectEmbeddingProvider() {
    // Check for available embedding APIs in order of preference
    const providers = [
      { name: 'openai', keyName: 'openai_api_key', url: 'https://api.openai.com/v1/embeddings', model: 'text-embedding-3-small' },
      { name: 'anthropic-via-openrouter', keyName: 'openrouter_api_key', url: 'https://openrouter.ai/api/v1/embeddings', model: 'openai/text-embedding-3-small' },
      { name: 'groq', keyName: 'groq_api_key', url: 'https://api.groq.com/openai/v1/embeddings', model: 'nomic-embed-text-v1.5' },
    ];

    for (const p of providers) {
      try {
        const key = this.secrets?.get?.(p.keyName);
        if (key) return { ...p, key };
      } catch { /* no key */ }
    }

    // Check config for primary provider key
    const primary = this.config.models?.primary;
    if (primary?.apiKey && primary.provider === 'openai') {
      return { name: 'openai', key: primary.apiKey, url: 'https://api.openai.com/v1/embeddings', model: 'text-embedding-3-small' };
    }

    return null;
  }

  async _embed(text) {
    const p = this._embeddingProvider;
    if (!p) throw new Error('No embedding provider');

    const res = await fetch(p.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${p.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: p.model,
        input: text.slice(0, 8000), // token limit safety
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Embedding API ${res.status}`);
    const data = await res.json();
    return data.data?.[0]?.embedding || null;
  }

  // ─── Cosine Similarity Search ──────────────────────────────

  _cosineSimilaritySearch(queryEmb, limit) {
    if (!queryEmb) return [];

    const scored = [];
    for (const doc of this.documents) {
      if (!doc.embedding) continue;
      const sim = this._cosine(queryEmb, doc.embedding);
      scored.push({ ...doc, score: sim });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(d => ({
        id: d.id,
        text: d.text,
        metadata: d.metadata,
        score: d.score,
        timestamp: d.timestamp,
      }));
  }

  _cosine(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  // ─── TF-IDF Keyword Search ────────────────────────────────

  _tfidfSearch(query, limit) {
    const queryTokens = this._tokenize(query);
    if (queryTokens.length === 0) {
      // No meaningful tokens — return recent
      return this.recent(limit);
    }

    // Build IDF cache if needed
    if (!this.idfCache) {
      this.idfCache = this._buildIDF();
    }

    const scored = [];
    for (const doc of this.documents) {
      const tokens = doc._tokens || this._tokenize(doc.text);
      const score = this._tfidfScore(queryTokens, tokens, this.idfCache);

      // Boost recent documents slightly
      const ageHours = (Date.now() - doc.timestamp) / 3600000;
      const recencyBoost = Math.max(0, 1 - ageHours / 720); // decay over 30 days

      scored.push({
        id: doc.id,
        text: doc.text,
        metadata: doc.metadata,
        score: score + recencyBoost * 0.1,
        timestamp: doc.timestamp,
      });
    }

    return scored
      .filter(d => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  _tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t));
  }

  _buildIDF() {
    const docCount = this.documents.length;
    const df = new Map(); // document frequency

    for (const doc of this.documents) {
      const tokens = doc._tokens || this._tokenize(doc.text);
      const unique = new Set(tokens);
      for (const token of unique) {
        df.set(token, (df.get(token) || 0) + 1);
      }
    }

    const idf = new Map();
    for (const [token, freq] of df) {
      idf.set(token, Math.log((docCount + 1) / (freq + 1)) + 1);
    }
    return idf;
  }

  _tfidfScore(queryTokens, docTokens, idf) {
    // Term frequency in document
    const tf = new Map();
    for (const t of docTokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    let score = 0;
    for (const qt of queryTokens) {
      const termFreq = (tf.get(qt) || 0) / (docTokens.length || 1);
      const inverseDocFreq = idf.get(qt) || 0;
      score += termFreq * inverseDocFreq;
    }
    return score;
  }

  // ─── Persistence ───────────────────────────────────────────

  _flush() {
    if (!this._dirty) return;
    try {
      const dir = this.config._dir;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      // Don't save embeddings to disk (they're large and can be regenerated)
      const slim = this.documents.map(d => ({
        id: d.id,
        text: d.text,
        metadata: d.metadata,
        timestamp: d.timestamp,
        _tokens: d._tokens,
        // Skip embedding to save disk space — regenerate on demand
      }));

      writeFileSync(this.storePath, JSON.stringify(slim));
      this._dirty = false;
    } catch (err) {
      log.debug(`VectorMemory: save failed: ${err.message}`);
    }
  }
}

// Common English stop words
const STOP_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her',
  'she', 'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there',
  'their', 'what', 'so', 'up', 'out', 'if', 'about', 'who', 'get',
  'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no',
  'just', 'him', 'know', 'take', 'people', 'into', 'year', 'your',
  'good', 'some', 'could', 'them', 'see', 'other', 'than', 'then',
  'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first',
  'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us', 'was', 'are', 'been', 'has', 'had',
  'were', 'did', 'does', 'is', 'am', 'being', 'been', 'very', 'much',
]);
