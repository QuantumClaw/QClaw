/**
 * QuantumClaw Onboarding — Fast Mode
 *
 * 3 questions. That's it.
 * 1. AI provider + key
 * 2. Telegram bot token (optional)
 * 3. Your name
 *
 * Everything else (Cognee, AGEX, deps) is installed BEFORE this runs.
 * Telegram pairing happens AFTER via dashboard, not here.
 */

import * as p from '@clack/prompts';
import { banner, theme } from './brand.js';
import { saveConfig, loadConfig } from '../core/config.js';
import { SecretStore } from '../security/secrets.js';
import { TrustKernel } from '../security/trust-kernel.js';
import { existsSync } from 'fs';

const { green, yellow, cyan, reset, dim, bold, white } = theme;

export async function runOnboard() {
  banner();

  // ─── Step 1: AI Provider + Key ────────────────────────

  const provider = await p.select({
    message: 'AI provider:',
    options: [
      { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'Best reasoning' },
      { value: 'openai', label: 'OpenAI (GPT)', hint: 'All-rounder' },
      { value: 'groq', label: 'Groq', hint: 'Fast, free tier' },
      { value: 'openrouter', label: 'OpenRouter', hint: 'Many models, one key' },
      { value: 'google', label: 'Google (Gemini)', hint: 'Free tier' },
      { value: 'xai', label: 'xAI (Grok)' },
      { value: 'ollama', label: 'Ollama (local)', hint: 'Free, runs locally' },
    ]
  });
  if (p.isCancel(provider)) { p.cancel('Cancelled.'); process.exit(0); }

  // Default models per provider
  const defaults = {
    anthropic: 'claude-sonnet-4-5-20250929',
    openai: 'gpt-4o',
    groq: 'llama-3.3-70b-versatile',
    openrouter: 'anthropic/claude-sonnet-4-5',
    google: 'gemini-2.0-flash',
    xai: 'grok-2',
    ollama: 'llama3.3',
  };

  let apiKey = null;
  if (provider !== 'ollama') {
    const hints = {
      anthropic: 'console.anthropic.com',
      openai: 'platform.openai.com',
      groq: 'console.groq.com',
      openrouter: 'openrouter.ai/keys',
      google: 'aistudio.google.com',
      xai: 'console.x.ai',
    };

    apiKey = await p.password({
      message: `API key (${hints[provider] || provider}):`,
      validate: v => !v ? 'Required' : undefined
    });
    if (p.isCancel(apiKey)) { p.cancel('Cancelled.'); process.exit(0); }

    // Quick verify
    const s = p.spinner();
    s.start('Checking...');
    try {
      const ok = await verifyApiKey(provider, apiKey);
      s.stop(ok.ok ? `${green}✓${reset} Key works` : `${yellow}!${reset} ${ok.error} — saved anyway`);
    } catch {
      s.stop(`${yellow}!${reset} Can't verify — saved anyway`);
    }
  }

  // ─── Step 2: Telegram (optional) ──────────────────────

  const wantTelegram = await p.confirm({
    message: 'Connect a Telegram bot?',
    initialValue: true,
  });

  let telegramToken = null;
  if (!p.isCancel(wantTelegram) && wantTelegram) {
    p.note([
      `1. Open Telegram → search ${cyan}@BotFather${reset}`,
      `2. Send ${cyan}/newbot${reset} → pick a name`,
      `3. Copy the token`,
    ].join('\n'), 'Quick setup');

    let verified = false;
    while (!verified) {
      telegramToken = await p.password({ message: 'Bot token:' });
      if (p.isCancel(telegramToken)) { telegramToken = null; break; }

      const s = p.spinner();
      s.start('Checking...');
      try {
        const res = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`, {
          signal: AbortSignal.timeout(10000)
        });
        const data = await res.json();
        if (data.ok) {
          s.stop(`${green}✓${reset} Bot: @${data.result.username}`);
          verified = true;
        } else {
          s.stop(`${yellow}✗${reset} Invalid token — try again`);
          telegramToken = null;
        }
      } catch {
        s.stop(`${yellow}✗${reset} Can't reach Telegram — try again`);
        telegramToken = null;
      }
    }
  }

  // ─── Step 3: Name ─────────────────────────────────────

  const name = await p.text({
    message: 'Your name?',
    placeholder: 'e.g. Hayley',
    validate: v => !v ? 'Need a name' : undefined
  });
  if (p.isCancel(name)) { p.cancel('Cancelled.'); process.exit(0); }

  // Dashboard PIN (optional but recommended for remote access)
  const wantPin = await p.confirm({
    message: 'Set a dashboard PIN? (protects remote access)',
    initialValue: true
  });
  if (p.isCancel(wantPin)) { p.cancel('Cancelled.'); process.exit(0); }

  let dashPin = null;
  if (wantPin) {
    dashPin = await p.password({
      message: 'Dashboard PIN (4-8 digits):',
      validate: v => {
        if (!v) return 'Enter a PIN';
        if (!/^\d{4,8}$/.test(v)) return '4-8 digits only';
      }
    });
    if (p.isCancel(dashPin)) { p.cancel('Cancelled.'); process.exit(0); }
  }

  // ─── Save ─────────────────────────────────────────────

  const s = p.spinner();
  s.start('Saving...');

  const config = await loadConfig();

  config.agent = {
    name: 'QClaw',
    owner: name,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  config.models = config.models || {};
  config.models.primary = {
    provider,
    model: defaults[provider] || 'auto',
  };

  config.channels = config.channels || {};
  if (telegramToken) {
    config.channels.telegram = {
      enabled: true,
      dmPolicy: 'pairing',
      allowedUsers: []
    };
  }

  // Dashboard config
  const { randomBytes } = await import('crypto');
  const dashToken = randomBytes(16).toString('hex');
  config.dashboard = config.dashboard || {};
  config.dashboard.authToken = dashToken;
  config.dashboard.tokenCreatedAt = Date.now();
  config.dashboard.enabled = true;
  if (dashPin) config.dashboard.pin = dashPin;

  saveConfig(config);

  // Encrypted secrets
  const secrets = new SecretStore(config);
  await secrets.load();
  if (apiKey) secrets.set(`${provider}_api_key`, apiKey);
  if (telegramToken) secrets.set('telegram_bot_token', telegramToken);

  // Trust kernel
  const trustKernel = new TrustKernel(config);
  await trustKernel.load();

  // Register with Cognee if it's running (installed by start-termux.sh)
  try {
    const cogneeUrl = config.memory?.cognee?.url || 'http://localhost:8000';
    const res = await fetch(cogneeUrl + '/health', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      await fetch(cogneeUrl + '/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'agent@quantumclaw.local', password: 'QuantumClaw2026!' }),
        signal: AbortSignal.timeout(5000)
      }).catch(() => {});

      const loginRes = await fetch(cogneeUrl + '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'username=agent@quantumclaw.local&password=QuantumClaw2026!',
        signal: AbortSignal.timeout(5000)
      });
      if (loginRes.ok) {
        const data = await loginRes.json();
        if (data.access_token) secrets.set('cognee_token', data.access_token);
      }
    }
  } catch { /* Cognee not running — fine, degrades to SQLite */ }

  s.stop(`${green}✓${reset} Done`);

  // ─── Done ──

  console.log('');
  console.log(`  ${green}✓${reset} ${bold}Ready, ${name}.${reset}`);
  console.log('');
  console.log(`  ${green}┌─────────────────────────────────────────────────┐${reset}`);
  console.log(`  ${green}│${reset}                                                 ${green}│${reset}`);
  console.log(`  ${green}│${reset}  ${bold}Now run:${reset}                                      ${green}│${reset}`);
  console.log(`  ${green}│${reset}                                                 ${green}│${reset}`);
  console.log(`  ${green}│${reset}    ${cyan}qclaw start${reset}                                  ${green}│${reset}`);
  console.log(`  ${green}│${reset}                                                 ${green}│${reset}`);
  console.log(`  ${green}└─────────────────────────────────────────────────┘${reset}`);
  console.log('');

  if (telegramToken) {
    console.log(`  ${bold}After starting — pair Telegram:${reset}`);
    console.log('');
    console.log(`  ${dim}1.${reset} Send ${cyan}/start${reset} to your bot in Telegram`);
    console.log(`  ${dim}2.${reset} It replies with an 8-letter code`);
    console.log(`  ${dim}3.${reset} Open a new terminal tab and run:`);
    console.log('');
    console.log(`     ${cyan}qclaw pairing approve telegram CODE${reset}`);
    console.log('');
    console.log(`  ${dim}Replace CODE with the code from Telegram.${reset}`);
    console.log('');
  }

  console.log(`  ${bold}Useful commands:${reset}`);
  console.log(`  ${cyan}qclaw start${reset}       ${dim}launch agent + dashboard${reset}`);
  console.log(`  ${cyan}qclaw dashboard${reset}   ${dim}re-show dashboard URL${reset}`);
  console.log(`  ${cyan}qclaw chat${reset}        ${dim}chat in terminal${reset}`);
  console.log(`  ${cyan}qclaw status${reset}      ${dim}health check${reset}`);
  console.log(`  ${cyan}qclaw help${reset}        ${dim}all commands${reset}`);
  console.log('');
}


/**
 * Verify an API key with a lightweight call to the provider.
 */
async function verifyApiKey(provider, key) {
  const endpoints = {
    anthropic: {
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
    },
    openai: {
      url: 'https://api.openai.com/v1/models',
      headers: { 'Authorization': `Bearer ${key}` }
    },
    groq: {
      url: 'https://api.groq.com/openai/v1/models',
      headers: { 'Authorization': `Bearer ${key}` }
    },
    openrouter: {
      url: 'https://openrouter.ai/api/v1/models',
      headers: { 'Authorization': `Bearer ${key}` }
    },
    google: {
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    },
    xai: {
      url: 'https://api.x.ai/v1/models',
      headers: { 'Authorization': `Bearer ${key}` }
    },
    mistral: {
      url: 'https://api.mistral.ai/v1/models',
      headers: { 'Authorization': `Bearer ${key}` }
    },
    together: {
      url: 'https://api.together.xyz/v1/models',
      headers: { 'Authorization': `Bearer ${key}` }
    },
  };

  const ep = endpoints[provider];
  if (!ep) return { ok: true };

  const res = await fetch(ep.url, {
    method: ep.method || 'GET',
    headers: ep.headers || {},
    body: ep.body || undefined,
    signal: AbortSignal.timeout(10000)
  });

  if (res.ok || res.status === 200 || res.status === 201) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'Invalid key' };
  return { ok: true }; // Other status codes (rate limit, etc) mean key works
}
