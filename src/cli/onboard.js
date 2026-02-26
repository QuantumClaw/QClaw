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

  // ─── Step 2b: Discord (optional) ──────────────────────

  const wantDiscord = await p.confirm({
    message: 'Connect a Discord bot?',
    initialValue: false,
  });

  let discordToken = null;
  if (!p.isCancel(wantDiscord) && wantDiscord) {
    p.note([
      `1. Go to ${cyan}discord.com/developers/applications${reset}`,
      `2. Create New Application → Bot → Reset Token → Copy`,
      `3. Enable MESSAGE CONTENT intent in Bot settings`,
      `4. Invite bot to your server with Messages + Read permissions`,
    ].join('\n'), 'Discord setup');

    let verified = false;
    while (!verified) {
      discordToken = await p.password({ message: 'Bot token:' });
      if (p.isCancel(discordToken)) { discordToken = null; break; }

      const s = p.spinner();
      s.start('Checking...');
      try {
        const res = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { 'Authorization': `Bot ${discordToken}` },
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (res.ok && data.username) {
          s.stop(`${green}✓${reset} Bot: ${data.username}#${data.discriminator || '0'}`);
          verified = true;
        } else {
          s.stop(`${yellow}✗${reset} Invalid token — try again`);
          discordToken = null;
        }
      } catch {
        s.stop(`${yellow}✗${reset} Can't reach Discord — try again`);
        discordToken = null;
      }
    }
  }

  // ─── Step 3: Embeddings for Knowledge Graph ──────────
  //
  // Cognee needs an embedding model to build the knowledge graph.
  // Best practice: use a cheap embedding model (OpenAI recommended for cost/quality).
  // The user's main LLM key can often double as the embedding key.

  const embeddingProvider = await p.select({
    message: 'Embedding model (for knowledge graph):',
    options: [
      { value: 'openai', label: 'OpenAI (recommended)', hint: 'text-embedding-3-small — cheapest + best' },
      { value: 'same', label: `Same as ${provider}`, hint: provider === 'openai' ? 'Uses your OpenAI key' : 'May need OpenAI-compatible endpoint' },
      { value: 'ollama', label: 'Ollama (local, free)', hint: 'Needs Ollama running locally' },
      { value: 'fastembed', label: 'Fastembed (local, free)', hint: 'CPU-only, no GPU needed' },
      { value: 'skip', label: 'Skip (use basic vector memory)', hint: 'No knowledge graph — simpler but less powerful' },
    ]
  });
  if (p.isCancel(embeddingProvider)) { p.cancel('Cancelled.'); process.exit(0); }

  let embeddingKey = null;
  let embeddingConfig = null;

  if (embeddingProvider !== 'skip') {
    // Embedding model defaults
    const embDefaults = {
      openai:    { provider: 'openai',    model: 'openai/text-embedding-3-small', dimensions: 1536 },
      same:      { provider: provider,    model: 'auto', dimensions: 1536 },
      ollama:    { provider: 'ollama',    model: 'nomic-embed-text', dimensions: 768, endpoint: 'http://localhost:11434/api/embeddings' },
      fastembed: { provider: 'fastembed', model: 'sentence-transformers/all-MiniLM-L6-v2', dimensions: 384 },
    };

    embeddingConfig = embDefaults[embeddingProvider] || embDefaults.openai;

    // If they chose 'same', inherit from main provider
    if (embeddingProvider === 'same') {
      embeddingKey = apiKey; // reuse the same key
      if (provider === 'openai') {
        embeddingConfig = { provider: 'openai', model: 'openai/text-embedding-3-small', dimensions: 1536 };
      } else if (provider === 'anthropic') {
        // Anthropic has no embeddings — fall back to OpenAI or fastembed
        p.note(`Anthropic doesn't offer embeddings. Using Fastembed (free, local).`);
        embeddingConfig = embDefaults.fastembed;
        embeddingKey = null;
      }
    }

    // Need a separate API key?
    if ((embeddingProvider === 'openai' && provider !== 'openai') ||
        (embeddingProvider === 'same' && !embeddingKey && embeddingConfig.provider === 'openai')) {
      embeddingKey = await p.password({
        message: 'OpenAI key for embeddings (platform.openai.com):',
        validate: v => !v ? 'Required for OpenAI embeddings' : undefined,
      });
      if (p.isCancel(embeddingKey)) { p.cancel('Cancelled.'); process.exit(0); }
    } else if (embeddingProvider === 'openai' && provider === 'openai') {
      embeddingKey = apiKey; // reuse
    }

    if (embeddingConfig) {
      const s2 = p.spinner();
      s2.start('Configuring embeddings...');
      s2.stop(`${green}✓${reset} Embeddings: ${embeddingConfig.provider}/${embeddingConfig.model}`);
    }
  }

  // ─── Step 4: Your Name ──────────────────────────────

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

  // Persistent tunnel (optional — keeps same URL across restarts)
  const wantTunnel = await p.confirm({
    message: 'Set up a persistent tunnel URL? (same link every time)',
    initialValue: false
  });
  if (p.isCancel(wantTunnel)) { p.cancel('Cancelled.'); process.exit(0); }

  let tunnelToken = null;
  if (wantTunnel) {
    console.log('');
    console.log(`  ${dim}To get a persistent tunnel URL:${reset}`);
    console.log(`  ${dim}1.${reset} Go to ${cyan}https://one.dash.cloudflare.com${reset}`);
    console.log(`  ${dim}2.${reset} Networks → Tunnels → Create a tunnel`);
    console.log(`  ${dim}3.${reset} Name it "qclaw", pick your domain`);
    console.log(`  ${dim}4.${reset} Set service to ${cyan}http://localhost:3000${reset}`);
    console.log(`  ${dim}5.${reset} Copy the tunnel token from the install command`);
    console.log('');
    tunnelToken = await p.password({
      message: 'Tunnel token (or Enter to skip):',
    });
    if (p.isCancel(tunnelToken)) { p.cancel('Cancelled.'); process.exit(0); }
    if (!tunnelToken?.trim()) tunnelToken = null;
  }

  // ─── Save ─────────────────────────────────────────────

  const s = p.spinner();
  s.start('Saving...');

  const config = await loadConfig();

  config.agent = {
    owner: name,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    hatched: false,  // becomes true after first chat
  };

  config.models = config.models || {};
  config.models.primary = {
    provider,
    model: defaults[provider] || 'auto',
  };

  // Embedding / Cognee config
  if (embeddingConfig) {
    config.memory = config.memory || {};
    config.memory.cognee = config.memory.cognee || {};
    config.memory.cognee.url = config.memory.cognee.url || 'http://localhost:8000';
    config.memory.embedding = {
      provider: embeddingConfig.provider,
      model: embeddingConfig.model,
      dimensions: embeddingConfig.dimensions,
      ...(embeddingConfig.endpoint && { endpoint: embeddingConfig.endpoint }),
    };
  }

  config.channels = config.channels || {};
  if (telegramToken) {
    config.channels.telegram = {
      enabled: true,
      dmPolicy: 'pairing',
      allowedUsers: []
    };
  }
  if (discordToken) {
    config.channels.discord = {
      enabled: true,
      allowedUsers: [],
      allowedChannels: [], // empty = respond to @mentions everywhere
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
  if (tunnelToken) {
    config.dashboard.tunnel = 'cloudflare';
    config.dashboard.tunnelToken = tunnelToken;
  }

  saveConfig(config);

  // Encrypted secrets
  const secrets = new SecretStore(config);
  await secrets.load();
  if (apiKey) secrets.set(`${provider}_api_key`, apiKey);
  if (telegramToken) secrets.set('telegram_bot_token', telegramToken);
  if (discordToken) secrets.set('discord_bot_token', discordToken);
  if (tunnelToken) secrets.set('cloudflare_tunnel_token', tunnelToken);
  if (embeddingKey) secrets.set('embedding_api_key', embeddingKey);

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

  // ─── Inline Telegram Pairing ──────────────────────────

  if (telegramToken) {
    console.log('');
    console.log(`  ${bold}Telegram Pairing${reset}`);
    console.log('');
    console.log(`  ${dim}1.${reset} Open Telegram on your phone`);
    console.log(`  ${dim}2.${reset} Send ${cyan}/start${reset} to your bot`);
    console.log(`  ${dim}3.${reset} It will reply with an 8-letter code`);
    console.log(`  ${dim}4.${reset} Type that code below`);
    console.log('');

    // Start a temporary Telegram bot to capture the pairing code
    let pairingDone = false;
    let pairingCode = null;
    let pairingUserId = null;
    let pairingUsername = null;
    let pairingChatId = null;
    let botInstance = null;

    try {
      const { Bot } = await import('grammy');
      botInstance = new Bot(telegramToken);

      // Generate pairing code
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const { randomBytes: rb } = await import('crypto');
      const bytes = rb(8);
      const generatedCode = Array.from(bytes).map(b => chars[b % chars.length]).join('');

      botInstance.command('start', async (ctx) => {
        pairingUserId = String(ctx.from.id);
        pairingUsername = ctx.from.username || ctx.from.first_name || 'unknown';
        pairingChatId = ctx.chat.id;
        pairingCode = generatedCode;

        await ctx.reply(`Welcome to QuantumClaw! 🧠\n\nYour pairing code:`);
        await ctx.reply(generatedCode);
        await ctx.reply(`Type this code in your terminal to complete pairing.`);
      });

      // Start bot in background (non-blocking)
      botInstance.start({ onStart: () => {} });

      // Wait for user to enter the code
      const codeInput = await p.text({
        message: 'Paste the 8-letter code from Telegram:',
        placeholder: 'e.g. AB3CD5EF',
        validate: v => {
          if (!v) return 'Enter the code from Telegram';
          if (v.length !== 8) return 'Code should be 8 characters';
        }
      });

      if (!p.isCancel(codeInput)) {
        const entered = codeInput.toUpperCase().trim();

        if (pairingCode && entered === pairingCode && pairingUserId) {
          // Approve — add to allowlist
          config.channels.telegram.allowedUsers = config.channels.telegram.allowedUsers || [];
          if (!config.channels.telegram.allowedUsers.includes(pairingUserId)) {
            config.channels.telegram.allowedUsers.push(pairingUserId);
          }
          saveConfig(config);

          console.log(`  ${green}✓${reset} Paired with @${pairingUsername} (${pairingUserId})`);
          pairingDone = true;
        } else if (!pairingCode) {
          console.log(`  ${yellow}!${reset} No pairing request received yet. Send /start to your bot first.`);
          console.log(`  ${dim}You can pair later: qclaw pairing approve telegram CODE${reset}`);
        } else {
          console.log(`  ${yellow}!${reset} Code doesn't match. You can pair later:`);
          console.log(`  ${cyan}qclaw pairing approve telegram ${pairingCode}${reset}`);
        }
      }

      // Stop the temporary bot
      try { await botInstance.stop(); } catch {}

    } catch (err) {
      console.log(`  ${yellow}!${reset} Telegram pairing skipped: ${err.message}`);
      console.log(`  ${dim}You can pair after starting: qclaw pairing approve telegram CODE${reset}`);
    }

    if (!pairingDone) {
      console.log('');
      console.log(`  ${dim}To pair later after starting the agent:${reset}`);
      console.log(`  ${dim}1.${reset} Send ${cyan}/start${reset} to your bot`);
      console.log(`  ${dim}2.${reset} Run: ${cyan}qclaw pairing approve telegram CODE${reset}`);
      console.log('');
    }
  }

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
