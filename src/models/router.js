/**
 * QuantumClaw Model Router
 *
 * 5-tier smart routing. "Thanks" doesn't cost the same as "analyse my pipeline."
 * Saves 60-80% on API costs vs single-model routing.
 *
 * Tier 0 REFLEX:   Pattern match → instant response, no LLM
 * Tier 1 SIMPLE:   Fast model (Groq) → ~200ms
 * Tier 2 STANDARD: Primary model → ~1s
 * Tier 3 COMPLEX:  Primary model with extended context → ~3s
 * Tier 4 VOICE:    Fast model, optimised for real-time → ~200ms
 */

import { log } from '../core/logger.js';

// Cost per 1M tokens (approximate, for tracking)
const COST_TABLE = {
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'llama-3.3-70b': { input: 0, output: 0 }, // Groq free tier
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
};

const REFLEX_RESPONSES = {
  'hello': 'Hey! What can I do for you?',
  'hi': 'Hi! What do you need?',
  'hey': 'Hey! What\'s up?',
  'thanks': 'No problem.',
  'thank you': 'You\'re welcome.',
  'cheers': 'No worries.',
  'ta': 'Anytime.',
  'ok': 'Got it.',
  'bye': 'Catch you later.',
  'yes': 'Noted.',
  'no': 'Understood.',
};

export class ModelRouter {
  constructor(config, secrets) {
    this.config = config;
    this.secrets = secrets;
    this.primary = config.models?.primary || {};
    // fast model must have a provider to be usable
    const fast = config.models?.fast;
    this.fast = (fast && fast.provider) ? fast : null;
    this.routingConfig = config.models?.routing || { enabled: true };
    this.providers = {};

    // Debug: log what we loaded
    if (this.primary.provider) {
      log.debug(`Router: primary=${this.primary.provider}/${this.primary.model}`);
    } else {
      log.warn('Router: No primary model configured — run: qclaw onboard');
    }
  }

  async verify() {
    const models = [];

    // Verify primary model
    if (this.primary.provider) {
      try {
        await this._testProvider(this.primary);
        models.push(`${this.primary.provider}/${this.primary.model}`);
      } catch (err) {
        log.error(`Primary model failed: ${err.message}`);
      }
    }

    // Verify fast model
    if (this.fast && this.fast.provider) {
      try {
        await this._testProvider(this.fast);
        models.push(`${this.fast.provider}/${this.fast.model} (fast)`);
      } catch (err) {
        log.warn(`Fast model failed: ${err.message} — will use primary for everything`);
        this.fast = null;
      }
    }

    return { models };
  }

  /**
   * Route a message to the appropriate model tier
   */
  classify(message) {
    if (!this.routingConfig.enabled) {
      return { tier: 'standard', model: this.primary };
    }

    const lower = message.trim().toLowerCase();

    // Tier 0: Reflex (no LLM needed)
    if (REFLEX_RESPONSES[lower]) {
      return {
        tier: 'reflex',
        model: null,
        response: REFLEX_RESPONSES[lower]
      };
    }

    // Tier 1: Simple (fast model)
    if (this.fast && this._isSimple(lower)) {
      return { tier: 'simple', model: this.fast };
    }

    // Tier 3: Complex (primary with more context — checked before standard fallback)
    if (this._isComplex(lower)) {
      return { tier: 'complex', model: this.primary, extendedContext: true };
    }

    // Tier 2: Standard (primary model, default fallback)
    return { tier: 'standard', model: this.primary };
  }

  /**
   * Make an LLM completion call
   */
  async complete(messages, options = {}) {
    const model = options.model || this.primary;

    // Defensive: if model config is empty or missing provider, give clear error
    if (!model || !model.provider) {
      throw new Error(
        'No AI provider configured. Run: qclaw onboard\n' +
        `  (model config: ${JSON.stringify(model)})`
      );
    }

    const provider = model.provider;
    const startTime = Date.now();

    let apiKey = await this.secrets.get(`${provider}_api_key`);
    if (!apiKey) apiKey = model.apiKey;

    // Defensive: catch case where secrets.get() returned a non-string (e.g. Promise)
    if (apiKey && typeof apiKey !== 'string') {
      log.error(`API key for ${provider} is ${typeof apiKey}, not string — credential manager may be returning a Promise`);
      apiKey = null;
    }

    if (!apiKey && provider !== 'ollama') {
      throw new Error(`No API key found for ${provider}. Run: qclaw onboard`);
    }

    let result;

    try {
      switch (provider) {
        case 'anthropic':
          result = await this._callAnthropic(apiKey, model.model, messages, options);
          break;
        case 'openai':
        case 'groq':
        case 'openrouter':
        case 'together':
        case 'mistral':
          result = await this._callOpenAICompat(provider, apiKey, model.model, messages, options);
          break;
        case 'ollama':
          result = await this._callOllama(model.model, messages, options);
          break;
        default:
          // Try OpenAI-compatible endpoint
          result = await this._callOpenAICompat(provider, apiKey, model.model, messages, options);
      }
    } catch (err) {
      log.error(`LLM call failed [${provider}/${model.model}]: ${err.message}`);
      throw err;
    }

    const duration = Date.now() - startTime;
    const cost = this._estimateCost(model.model, result.usage);

    return {
      content: result.content,
      model: model.model,
      provider,
      usage: result.usage,
      cost,
      duration
    };
  }

  _isSimple(msg) {
    const simplePatterns = [
      /^what time/i, /^when is/i, /^remind me/i, /^send (a )?message/i,
      /^check my/i, /^show me/i, /^how many/i, /^list/i,
      /^next meeting/i, /^schedule/i, /^what's (on|next)/i
    ];
    return simplePatterns.some(p => p.test(msg)) || msg.split(' ').length <= 5;
  }

  _isComplex(msg) {
    const complexPatterns = [
      /analys/i, /strateg/i, /compare/i, /review/i, /plan/i,
      /research/i, /deep dive/i, /evaluate/i, /assess/i,
      /pipeline/i, /forecast/i, /recommend/i, /optimis/i
    ];
    return complexPatterns.some(p => p.test(msg)) || msg.split(' ').length > 50;
  }

  _estimateCost(model, usage) {
    if (!usage) return 0;
    const rates = COST_TABLE[model] || { input: 1, output: 5 };
    const inputCost = (usage.input_tokens || 0) / 1_000_000 * rates.input;
    const outputCost = (usage.output_tokens || 0) / 1_000_000 * rates.output;
    return Math.round((inputCost + outputCost) * 10000) / 10000; // 4 decimal places
  }

  async _testProvider(model) {
    let apiKey = await this.secrets.get(`${model.provider}_api_key`);
    if (!apiKey) apiKey = model.apiKey;

    // Defensive: catch non-string keys
    if (apiKey && typeof apiKey !== 'string') {
      throw new Error(`API key for ${model.provider} resolved as ${typeof apiKey} instead of string`);
    }

    if (!apiKey && model.provider !== 'ollama') {
      throw new Error(`No API key found for ${model.provider}`);
    }

    // Lightweight verification — call the models endpoint or equivalent
    try {
      switch (model.provider) {
        case 'anthropic': {
          // Anthropic doesn't have a /models endpoint, so we make a minimal call
          // A 400 (bad request) still proves the key is valid
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({ model: model.model, max_tokens: 1, messages: [{ role: 'user', content: 'test' }] }),
            signal: AbortSignal.timeout(10000)
          });
          if (res.status === 401) throw new Error('Invalid API key');
          return true; // 200, 400, 429 all mean the key is valid
        }

        case 'ollama': {
          const url = this.config.models?.ollamaUrl || 'http://localhost:11434';
          const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) throw new Error(`Ollama not reachable (${res.status})`);
          return true;
        }

        default: {
          // OpenAI-compatible providers all have /models
          const endpoints = {
            openai: 'https://api.openai.com/v1/models',
            groq: 'https://api.groq.com/openai/v1/models',
            openrouter: 'https://openrouter.ai/api/v1/models',
            together: 'https://api.together.xyz/v1/models',
            mistral: 'https://api.mistral.ai/v1/models',
            xai: 'https://api.x.ai/v1/models',
          };
          const url = endpoints[model.provider];
          if (!url) return true; // Unknown provider, skip verification

          const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(10000)
          });
          if (res.status === 401) throw new Error('Invalid API key');
          if (!res.ok) throw new Error(`${model.provider} returned ${res.status}`);
          return true;
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`${model.provider} verification timed out`);
      throw err;
    }
  }

  async _callAnthropic(apiKey, model, messages, options) {
    // Anthropic API requires system as a top-level param, not in messages.
    // Messages array must only contain user/assistant with alternating roles.
    const systemParts = [];
    const chatMessages = [];

    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(typeof m.content === 'string' ? m.content : m.content);
      } else {
        chatMessages.push({ role: m.role, content: m.content });
      }
    }

    // Also include options.system if provided (but avoid duplicates)
    if (options.system && !systemParts.includes(options.system)) {
      systemParts.unshift(options.system);
    }

    // Enforce alternating roles — merge consecutive same-role messages
    const merged = [];
    for (const msg of chatMessages) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
        // Only merge string content; arrays (multimodal) stay separate
        const prev = merged[merged.length - 1];
        if (typeof prev.content === 'string' && typeof msg.content === 'string') {
          prev.content += '\n\n' + msg.content;
        } else {
          // Convert both to arrays and concat
          const prevArr = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: prev.content }];
          const msgArr = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }];
          prev.content = [...prevArr, ...msgArr];
        }
      } else {
        merged.push({ ...msg });
      }
    }

    // Anthropic requires first message to be user role
    if (merged.length > 0 && merged[0].role !== 'user') {
      merged.unshift({ role: 'user', content: '(continuing conversation)' });
    }

    // Must have at least one message
    if (merged.length === 0) {
      merged.push({ role: 'user', content: '(empty)' });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens || 4096,
        system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
        messages: merged
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic ${res.status}: ${err}`);
    }

    const data = await res.json();
    return {
      content: data.content[0]?.text || '',
      usage: {
        input_tokens: data.usage?.input_tokens || 0,
        output_tokens: data.usage?.output_tokens || 0
      }
    };
  }

  async _callOpenAICompat(provider, apiKey, model, messages, options) {
    const endpoints = {
      openai: 'https://api.openai.com/v1/chat/completions',
      groq: 'https://api.groq.com/openai/v1/chat/completions',
      openrouter: 'https://openrouter.ai/api/v1/chat/completions',
      together: 'https://api.together.xyz/v1/chat/completions',
      mistral: 'https://api.mistral.ai/v1/chat/completions',
      xai: 'https://api.x.ai/v1/chat/completions',
      google: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    };

    const url = endpoints[provider] || `${this.config.models?.customEndpoint}/v1/chat/completions`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens || 4096
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`${provider} ${res.status}: ${err}`);
    }

    const data = await res.json();
    return {
      content: data.choices[0]?.message?.content || '',
      usage: {
        input_tokens: data.usage?.prompt_tokens || 0,
        output_tokens: data.usage?.completion_tokens || 0
      }
    };
  }

  async _callOllama(model, messages, options) {
    const url = this.config.models?.ollamaUrl || 'http://localhost:11434';

    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false })
    });

    if (!res.ok) throw new Error(`Ollama ${res.status}`);

    const data = await res.json();
    return {
      content: data.message?.content || '',
      usage: {
        input_tokens: data.prompt_eval_count || 0,
        output_tokens: data.eval_count || 0
      }
    };
  }
}
