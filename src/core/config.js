/**
 * QuantumClaw Config
 *
 * Philosophy: validate what matters, warn on unknowns, never crash.
 * Encrypted secrets stay encrypted until the moment they're needed.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { log } from './logger.js';

const CONFIG_DIR = join(homedir(), '.quantumclaw');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  agent: {
    name: 'QClaw',
    owner: 'User',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    purpose: 'A helpful AI agent'
  },
  models: {
    primary: { provider: null, model: null },
    fast: null,
    routing: {
      enabled: true,
      tiers: {
        reflex: ['hello', 'hi', 'thanks', 'ok', 'bye', 'yes', 'no', 'cheers', 'ta'],
        simple: ['what time', 'next meeting', 'remind me', 'send message'],
        standard: ['draft', 'write', 'summarise', 'explain', 'help me'],
        complex: ['analyse', 'strategy', 'compare', 'review', 'plan'],
        voice: []
      }
    }
  },
  memory: {
    cognee: {
      url: 'http://localhost:8000',
      autoReconnect: true,
      healthCheckInterval: 60000,
      tokenRefresh: {
        enabled: true,
        refreshBeforeExpiry: 300000 // 5 minutes
      }
    },
    sqlite: {
      path: join(CONFIG_DIR, 'memory.db')
    }
  },
  dashboard: {
    enabled: true,
    port: 3000,
    host: '127.0.0.1',
    autoPort: true,
    tunnel: 'auto',
    tunnel_subdomain: null
  },
  channels: {},
  skills: {
    dir: null, // resolved at runtime
    clawhub: {
      mode: 'docs-only', // 'full' | 'docs-only' | 'disabled'
    }
  },
  security: {
    encryption: 'aes-256-gcm',
    shellAllowlist: [
      'ls', 'cat', 'head', 'tail', 'grep', 'wc', 'date', 'echo',
      'curl', 'wget', 'node', 'npm', 'npx', 'git', 'docker'
    ],
    requireApproval: ['rm', 'mv', 'chmod', 'chown', 'kill', 'shutdown']
  },
  heartbeat: {
    scheduled: [],
    eventDriven: true,
    graphDriven: false, // Off by default — costs money (LLM calls per query)
    graphDiscoveryIntervalHours: 4,
    maxDailyCost: 0.50,
    autoLearn: {
      enabled: false,       // Off by default — user opts in via CLI or dashboard
      maxQuestionsPerDay: 3,
      minIntervalHours: 4,  // Minimum gap between questions
      useFastModel: true,   // Use fast/free model to save costs
      quietHoursStart: 22,  // Don't message after 10pm
      quietHoursEnd: 8,     // Don't message before 8am
    }
  },
  evolution: {
    enabled: false // off by default, user opts in
  }
};

const KNOWN_KEYS = new Set(Object.keys(DEFAULTS));

export async function loadConfig() {
  // Ensure config dir exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // If no config, return defaults (onboard hasn't run yet)
  if (!existsSync(CONFIG_FILE)) {
    log.warn('No config found. Run `npx qclaw onboard` first.');
    return { ...DEFAULTS, _dir: CONFIG_DIR, _file: CONFIG_FILE };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (err) {
    log.error(`Config parse error: ${err.message}`);
    log.info('Using defaults. Your config file might have a syntax error.');
    return { ...DEFAULTS, _dir: CONFIG_DIR, _file: CONFIG_FILE };
  }

  // Merge with defaults (user values win)
  const config = deepMerge(DEFAULTS, raw);

  // Warn on unknown top-level keys (but don't crash)
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key) && !key.startsWith('_')) {
      log.warn(`Unknown config key "${key}" — ignoring. Typo?`);
    }
  }

  // Validate critical values
  if (config.models.primary.provider && !config.models.primary.model) {
    log.warn('Provider set but no model specified. Will auto-detect.');
  }

  config._dir = CONFIG_DIR;
  config._file = CONFIG_FILE;
  return config;
}

export function saveConfig(config) {
  const { _dir, _file, ...clean } = config;
  if (!existsSync(_dir)) mkdirSync(_dir, { recursive: true });

  // Atomic write: write to temp file then rename (rename is atomic on most filesystems)
  const tmpFile = _file + '.tmp';
  writeFileSync(tmpFile, JSON.stringify(clean, null, 2));
  renameSync(tmpFile, _file);
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] && typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object'
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
