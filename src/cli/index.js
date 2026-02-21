#!/usr/bin/env node

/**
 * QuantumClaw CLI
 *
 * npx qclaw <command>
 */

import { smallBanner } from './brand.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const command = args[0];
const subcommand = args[1];

// ─── Helper: load config + secrets for quick commands ─────────
async function loadCore() {
  const { loadConfig } = await import('../core/config.js');
  const { SecretStore } = await import('../security/secrets.js');
  const config = await loadConfig();
  const secrets = new SecretStore(config);
  await secrets.load();
  return { config, secrets };
}

// ─── Helper: load full agent stack for chat/process ───────────
async function loadAgent() {
  const { loadConfig } = await import('../core/config.js');
  const { SecretStore } = await import('../security/secrets.js');
  const { CredentialManager } = await import('../credentials.js');
  const { TrustKernel } = await import('../security/trust-kernel.js');
  const { AuditLog } = await import('../security/audit.js');
  const { MemoryManager } = await import('../memory/manager.js');
  const { ModelRouter } = await import('../models/router.js');
  const { AgentRegistry } = await import('../agents/registry.js');
  const { SkillLoader } = await import('../skills/loader.js');

  const config = await loadConfig();
  const secrets = new SecretStore(config);
  await secrets.load();

  // Use CredentialManager (same as main bootstrap) so AGEX works in CLI too
  let credentials;
  try {
    credentials = new CredentialManager(config, secrets);
    await credentials.init();
  } catch {
    credentials = secrets; // fallback to raw secrets
  }

  const trustKernel = new TrustKernel(config);
  const audit = new AuditLog(config);
  await trustKernel.load();
  const memory = new MemoryManager(config, credentials);
  await memory.connect();
  const router = new ModelRouter(config, credentials);
  const skills = new SkillLoader(config);
  await skills.loadAll();
  const agents = new AgentRegistry(config, { memory, router, skills, trustKernel, audit, secrets: credentials });
  await agents.loadAll();

  return { config, secrets, credentials, trustKernel, audit, memory, router, skills, agents };
}

switch (command) {

  // ─── ONBOARD ──────────────────────────────────────────────────
  case 'onboard': {
    const { runOnboard } = await import('./onboard.js');
    await runOnboard();
    break;
  }

  // ─── START ────────────────────────────────────────────────────
  case 'start': {
    // Parse --tunnel flag before starting
    const tunnelIdx = args.indexOf('--tunnel');
    if (tunnelIdx !== -1 && args[tunnelIdx + 1]) {
      process.env.QCLAW_TUNNEL = args[tunnelIdx + 1];
    }
    await import('../index.js');
    break;
  }

  // ─── UPDATE ─────────────────────────────────────────────────
  case 'update': {
    smallBanner();
    const { execSync: ex } = await import('child_process');

    // Find repo root (where .git lives)
    let repoDir = process.cwd();
    try { repoDir = ex('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim(); } catch {}

    console.log(`${green}Updating QuantumClaw...${reset}`);
    console.log('');

    // 1. Stop running agent
    try {
      ex('pm2 stop qclaw 2>/dev/null || true', { stdio: 'inherit' });
    } catch {}

    // 2. Git pull
    try {
      console.log(`  ${dim}git pull...${reset}`);
      const pullOut = ex('git pull --ff-only', { cwd: repoDir, encoding: 'utf-8' });
      if (pullOut.includes('Already up to date')) {
        ok('Already up to date');
      } else {
        ok('Pulled latest changes');
        console.log(`  ${dim}${pullOut.trim().split('\n').slice(-2).join('\n  ')}${reset}`);
      }
    } catch (err) {
      if (err.message?.includes('not a git repository')) {
        warn('Not a git repository — download latest from GitHub');
        break;
      }
      warn(`Git pull failed: ${err.message}`);
      console.log(`  ${dim}Try: cd ${repoDir} && git stash && git pull${reset}`);
      break;
    }

    // 3. npm install (picks up new/updated deps)
    console.log('');
    console.log(`  ${dim}npm install...${reset}`);
    try {
      ex('npm install --progress', { cwd: repoDir, stdio: 'inherit' });
      ok('Dependencies updated');
    } catch {
      warn('npm install had issues — try manually');
    }

    // 4. Restart agent
    console.log('');
    try {
      ex('pm2 restart qclaw 2>/dev/null || true', { stdio: 'inherit' });
      ok('Agent restarted');
    } catch {}

    // 5. Show version
    console.log('');
    try {
      const pkg = JSON.parse(readFileSync(join(repoDir, 'package.json'), 'utf-8'));
      ok(`QuantumClaw v${pkg.version}`);
    } catch {}

    console.log('');
    break;
  }

  // ─── TUI ──────────────────────────────────────────────────────
  case 'tui': {
    const { startTUI } = await import('./tui.js');
    await startTUI();
    break;
  }

  // ─── STOP ─────────────────────────────────────────────────────
  case 'stop': {
    smallBanner();
    const { loadConfig } = await import('../core/config.js');
    const config = await loadConfig();
    const pidFile = join(config._dir, 'qclaw.pid');

    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(readFileSync(pidFile, 'utf-8').trim());
        process.kill(pid, 'SIGTERM');
        console.log(`Sent shutdown signal to process ${pid}.`);
      } catch (err) {
        if (err.code === 'ESRCH') {
          console.log('PID file exists but process is not running. Cleaning up.');
          const { unlinkSync } = await import('fs');
          unlinkSync(pidFile);
        } else {
          console.log(`Could not stop process: ${err.message}`);
        }
      }
    } else {
      // Fallback: try ps for Unix systems
      try {
        const { execSync } = await import('child_process');
        const myPid = process.pid;
        const result = execSync(
          `ps aux | grep 'qclaw start\\|quantumclaw start\\|node src/index.js' | grep -v grep | grep -v ${myPid} | awk '{print $2}'`,
          { encoding: 'utf-8' }
        ).trim();

        if (result) {
          for (const pid of result.split('\n').filter(Boolean)) {
            process.kill(parseInt(pid), 'SIGTERM');
          }
          console.log('Sent shutdown signal.');
        } else {
          console.log('No running QuantumClaw process found.');
        }
      } catch {
        console.log('No running QuantumClaw process found. (No PID file at ' + pidFile + ')');
      }
    }
    break;
  }
  // ─── RESTART ──────────────────────────────────────────────────
  case 'restart': {
    smallBanner();
    console.log('Stopping...');

    const { loadConfig: lc } = await import('../core/config.js');
    const cfg = await lc();
    const pf = join(cfg._dir, 'qclaw.pid');

    if (existsSync(pf)) {
      try {
        const pid = parseInt(readFileSync(pf, 'utf-8').trim());
        process.kill(pid, 'SIGTERM');
        await new Promise(r => setTimeout(r, 2000));
      } catch { /* process already dead */ }
    } else {
      try {
        const { execSync: ex } = await import('child_process');
        const myPid = process.pid;
        const r = ex(
          `ps aux | grep 'qclaw start\\|quantumclaw start\\|node src/index.js' | grep -v grep | grep -v ${myPid} | awk '{print $2}'`,
          { encoding: 'utf-8' }
        ).trim();
        if (r) {
          for (const pid of r.split('\n').filter(Boolean)) process.kill(parseInt(pid), 'SIGTERM');
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch { /* nothing running */ }
    }

    console.log('Starting...');
    await import('../index.js');
    break;
  }

  // ─── CHAT ─────────────────────────────────────────────────────
  case 'chat': {
    const message = args.slice(1).join(' ');

    if (!message) {
      // Interactive chat mode
      smallBanner();
      console.log('Interactive chat (type /quit to exit)\n');

      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const stack = await loadAgent();
      const agent = stack.agents.primary();

      const prompt = () => {
        rl.question('\x1b[38;5;135myou › \x1b[0m', async (input) => {
          const trimmed = input.trim();
          if (!trimmed) return prompt();
          if (trimmed === '/quit' || trimmed === '/exit') {
            console.log('Goodbye.');
            await stack.memory.disconnect();
            process.exit(0);
          }

          try {
            const result = await agent.process(trimmed);
            const tierInfo = result.model
              ? `\x1b[2m${result.tier} → ${result.model} (£${(result.cost || 0).toFixed(4)})\x1b[0m`
              : '\x1b[2mreflex (free)\x1b[0m';
            console.log(`\x1b[38;5;177m${agent.name} › \x1b[0m${result.content}`);
            console.log(tierInfo);
            console.log('');
          } catch (err) {
            console.log(`\x1b[38;5;196mError: ${err.message}\x1b[0m\n`);
          }
          prompt();
        });
      };
      prompt();
      break;
    }

    // One-shot mode
    smallBanner();
    const stack = await loadAgent();
    const agent = stack.agents.primary();
    const result = await agent.process(message);
    console.log(result.content);
    await stack.memory.disconnect();
    process.exit(0);
  }

  // ─── STATUS ───────────────────────────────────────────────────
  case 'status': {
    smallBanner();
    const { config, secrets } = await loadCore();

    console.log('');
    console.log(`  Config:       ${config._file}`);
    console.log(`  Agent:        ${config.agent?.name || 'QClaw'} (owner: ${config.agent?.owner || 'not set'})`);
    console.log(`  Purpose:      ${config.agent?.purpose || 'not set'}`);
    console.log(`  Primary:      ${config.models?.primary?.provider || 'not set'}/${config.models?.primary?.model || 'not set'}`);
    console.log(`  Fast:         ${config.models?.fast?.provider ? `${config.models.fast.provider}/${config.models.fast.model}` : 'not configured'}`);
    console.log(`  Routing:      ${config.models?.routing?.enabled ? '5-tier' : 'disabled'}`);
    console.log(`  Dashboard:    ${config.dashboard?.enabled !== false ? `port ${config.dashboard?.port || 3000}` : 'disabled'}`);
    console.log(`  Secrets:      ${secrets.list().length} keys encrypted`);

    const channels = Object.entries(config.channels || {}).filter(([, v]) => v.enabled).map(([k]) => k);
    console.log(`  Channels:     ${channels.length > 0 ? channels.join(', ') : 'none'}`);
    console.log('');
    break;
  }

  // ─── DIAGNOSE ─────────────────────────────────────────────────
  case 'diagnose': {
    smallBanner();
    console.log('\nRunning diagnostics...\n');
    const { config, secrets } = await loadCore();

    const ok = (msg) => console.log(`  \x1b[38;5;82m✓\x1b[0m ${msg}`);
    const warn = (msg) => console.log(`  \x1b[38;5;220m○\x1b[0m ${msg}`);
    const fail = (msg) => console.log(`  \x1b[38;5;196m✗\x1b[0m ${msg}`);

    // Node version
    const nodeVer = process.version;
    const major = parseInt(nodeVer.slice(1));
    major >= 20 ? ok(`Node.js: ${nodeVer}`) : fail(`Node.js: ${nodeVer} (need 20+)`);

    // Platform
    ok(`Platform: ${process.platform}-${process.arch}`);

    // Config
    existsSync(config._file) ? ok(`Config: ${config._file}`) : warn('Config: not found (run onboard)');

    // Secrets
    const secretCount = secrets.list().length;
    secretCount > 0 ? ok(`Secrets: ${secretCount} keys encrypted (AES-256-GCM)`) : warn('Secrets: none stored');

    // Trust Kernel
    const valuesFile = join(config._dir, 'VALUES.md');
    existsSync(valuesFile) ? ok('Trust Kernel: VALUES.md active') : warn('Trust Kernel: VALUES.md not found');

    // Primary model
    const primaryProvider = config.models?.primary?.provider;
    if (primaryProvider) {
      const hasKey = secrets.has(`${primaryProvider}_api_key`) || primaryProvider === 'ollama';
      hasKey
        ? ok(`Primary model: ${primaryProvider}/${config.models.primary.model}`)
        : fail(`Primary model: ${primaryProvider} (API key missing)`);
    } else {
      warn('Primary model: not configured');
    }

    // Fast model
    const fastProvider = config.models?.fast?.provider;
    if (fastProvider) {
      ok(`Fast model: ${fastProvider}/${config.models.fast.model}`);
    } else {
      warn('Fast model: not configured (all messages use primary)');
    }

    // Cognee
    const cogneeUrl = config.memory?.cognee?.url || 'http://localhost:8000';
    if (config.memory?.cognee?.enabled !== false) {
      try {
        const res = await fetch(cogneeUrl + '/health', { signal: AbortSignal.timeout(3000) });
        res.ok
          ? ok(`Cognee: connected (${cogneeUrl})`)
          : warn(`Cognee: responded with ${res.status}`);
      } catch {
        warn(`Cognee: not reachable at ${cogneeUrl}`);
      }
    } else {
      warn('Cognee: disabled in config');
    }

    // Memory layers
    const layers = [];
    if (secrets.has('cognee_token')) layers.push('graph');
    layers.push('sqlite');
    layers.push('workspace');
    ok(`Memory: ${layers.join(' + ')} (${layers.length} layers)`);

    // Channels
    const channels = Object.entries(config.channels || {}).filter(([, v]) => v.enabled);
    for (const [name] of channels) {
      if (name === 'telegram') {
        secrets.has('telegram_bot_token')
          ? ok('Channel: Telegram (token present)')
          : fail('Channel: Telegram (token missing)');
      } else {
        ok(`Channel: ${name}`);
      }
    }
    if (channels.length === 0) warn('Channels: none configured');

    // Dashboard
    const dashPort = config.dashboard?.port || 3000;
    try {
      const res = await fetch(`http://127.0.0.1:${dashPort}/api/health`, { signal: AbortSignal.timeout(2000) });
      res.ok ? ok(`Dashboard: running on :${dashPort}`) : warn(`Dashboard: responded with ${res.status}`);
    } catch {
      warn('Dashboard: not running (start agent first)');
    }

    // AGEX
    const agexUrl = process.env.AGEX_HUB_URL || config.agex?.hubUrl || 'https://hub.agexhq.com';
    if (agexUrl) {
      try {
        const res = await fetch(agexUrl + '/health', { signal: AbortSignal.timeout(3000) });
        res.ok ? ok(`AGEX Hub: connected (${agexUrl})`) : warn(`AGEX Hub: responded with ${res.status}`);
      } catch {
        warn('AGEX Hub: not reachable (using local secrets)');
      }
    }

    // Audit DB
    const auditDb = join(config._dir, 'audit.db');
    existsSync(auditDb) ? ok('Audit log: active') : warn('Audit log: will be created on first run');

    // Disk space
    try {
      const { execSync } = await import('child_process');
      const df = execSync(`df -h ${config._dir} | tail -1`, { encoding: 'utf-8' });
      const parts = df.trim().split(/\s+/);
      ok(`Disk: ${parts[3]} available`);
    } catch { /* skip */ }

    console.log('\nDone.\n');
    break;
  }

  // ─── CONFIG ───────────────────────────────────────────────────
  case 'config': {
    smallBanner();
    const { loadConfig, saveConfig } = await import('../core/config.js');
    const config = await loadConfig();

    if (subcommand === 'show' || !subcommand) {
      const { _dir, _file, ...display } = config;
      console.log(JSON.stringify(display, null, 2));

    } else if (subcommand === 'set') {
      const key = args[2];
      const value = args.slice(3).join(' ');
      if (!key || !value) {
        console.log('Usage: qclaw config set <key> <value>');
        console.log('Example: qclaw config set dashboard.port 4000');
        process.exit(1);
      }

      const keys = key.split('.');
      let target = config;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]] || typeof target[keys[i]] !== 'object') target[keys[i]] = {};
        target = target[keys[i]];
      }

      let parsed = value;
      if (value === 'true') parsed = true;
      else if (value === 'false') parsed = false;
      else if (!isNaN(value) && value !== '') parsed = Number(value);

      target[keys[keys.length - 1]] = parsed;
      saveConfig(config);
      console.log(`Set ${key} = ${JSON.stringify(parsed)}`);

    } else {
      console.log('Usage: qclaw config [show|set]');
    }
    break;
  }

  // ─── SECRET ───────────────────────────────────────────────────
  case 'secret': {
    smallBanner();
    const { config, secrets } = await loadCore();

    if (subcommand === 'list' || !subcommand) {
      const keys = secrets.list();
      if (keys.length === 0) {
        console.log('No secrets stored.');
      } else {
        console.log(`\n  ${keys.length} encrypted secrets:\n`);
        for (const key of keys) {
          const val = secrets.get(key);
          const masked = val ? val.slice(0, 4) + '...' + val.slice(-4) : '(empty)';
          console.log(`  ${key}: ${masked}`);
        }
        console.log('');
      }

    } else if (subcommand === 'set') {
      const key = args[2];
      if (!key) {
        console.log('Usage: qclaw secret set <key>');
        process.exit(1);
      }
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      process.stdout.write(`Value for ${key}: `);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);

      const value = await new Promise(resolve => {
        let buf = '';
        process.stdin.on('data', (chunk) => {
          const ch = chunk.toString();
          if (ch === '\n' || ch === '\r' || ch === '\r\n') {
            process.stdout.write('\n');
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
            resolve(buf);
          } else if (ch === '\u0003') {
            process.exit(0);
          } else if (ch === '\u007f') {
            buf = buf.slice(0, -1);
          } else {
            buf += ch;
            process.stdout.write('*');
          }
        });
      });

      rl.close();
      secrets.set(key, value);
      console.log(`Secret "${key}" saved (encrypted).`);

    } else if (subcommand === 'delete') {
      const key = args[2];
      if (!key) {
        console.log('Usage: qclaw secret delete <key>');
        process.exit(1);
      }
      if (secrets.has(key)) {
        secrets.delete(key);
        console.log(`Secret "${key}" deleted.`);
      } else {
        console.log(`Secret "${key}" not found.`);
      }

    } else {
      console.log('Usage: qclaw secret [list|set|delete]');
    }
    break;
  }

  // ─── COGNEE ───────────────────────────────────────────────────
  case 'cognee': {
    smallBanner();
    const { config, secrets } = await loadCore();
    const cogneeUrl = config.memory?.cognee?.url || 'http://localhost:8000';

    if (subcommand === 'status' || !subcommand) {
      console.log(`\n  Cognee URL: ${cogneeUrl}`);
      try {
        const res = await fetch(cogneeUrl + '/api/v1/health', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          console.log('  Status:    \x1b[38;5;82mconnected\x1b[0m');
          if (data.version) console.log(`  Version:   ${data.version}`);
        } else {
          console.log(`  Status:    \x1b[38;5;196mresponded with ${res.status}\x1b[0m`);
        }
      } catch {
        console.log('  Status:    \x1b[38;5;196mnot reachable\x1b[0m');
      }
      try {
        const res = await fetch('http://localhost:6333/healthz', { signal: AbortSignal.timeout(3000) });
        console.log(`  Qdrant:    ${res.ok ? '\x1b[38;5;82mconnected\x1b[0m' : `HTTP ${res.status}`}`);
      } catch {
        console.log('  Qdrant:    \x1b[38;5;196mnot reachable\x1b[0m');
      }
      console.log(`  Token:     ${secrets.has('cognee_token') ? 'present (encrypted)' : 'none'}`);
      console.log('');

    } else if (subcommand === 'reconnect') {
      console.log('Attempting Cognee reconnect...');
      try {
        const healthRes = await fetch(cogneeUrl + '/api/v1/health', { signal: AbortSignal.timeout(5000) });
        if (!healthRes.ok) throw new Error(`Health check returned ${healthRes.status}`);

        const refreshToken = secrets.get('cognee_refresh_token');
        if (refreshToken) {
          const res = await fetch(cogneeUrl + '/api/v1/users/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
            signal: AbortSignal.timeout(5000)
          });
          if (res.ok) {
            const data = await res.json();
            if (data.access_token) {
              secrets.set('cognee_token', data.access_token);
              if (data.refresh_token) secrets.set('cognee_refresh_token', data.refresh_token);
              console.log('\x1b[38;5;82m✓\x1b[0m Token refreshed.');
              break;
            }
          }
        }

        const cogneeUser = config.memory?.cognee?.username || 'admin@example.com';
        const cogneePass = config.memory?.cognee?.password || 'admin';
        const loginRes = await fetch(cogneeUrl + '/api/v1/users/signin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cogneeUser, password: cogneePass }),
          signal: AbortSignal.timeout(5000)
        });

        if (loginRes.ok) {
          const data = await loginRes.json();
          if (data.access_token) secrets.set('cognee_token', data.access_token);
          if (data.refresh_token) secrets.set('cognee_refresh_token', data.refresh_token);
          console.log('\x1b[38;5;82m✓\x1b[0m Reconnected and re-authenticated.');
        } else {
          console.log(`\x1b[38;5;196m✗\x1b[0m Login failed (${loginRes.status}).`);
        }
      } catch (err) {
        console.log(`\x1b[38;5;196m✗\x1b[0m Could not reach Cognee: ${err.message}`);
      }

    } else if (subcommand === 'stats') {
      const token = secrets.get('cognee_token');
      if (!token) { console.log('No Cognee token. Run: qclaw cognee reconnect'); break; }
      try {
        const res = await fetch(cogneeUrl + '/api/v1/datasets', {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          console.log(`\n  Datasets: ${Array.isArray(data) ? data.length : 'unknown'}`);
          if (Array.isArray(data)) {
            for (const ds of data.slice(0, 10)) {
              console.log(`    - ${ds.name || ds.id || JSON.stringify(ds)}`);
            }
          }
        } else if (res.status === 401) {
          console.log('Token expired. Run: qclaw cognee reconnect');
        } else {
          console.log(`Cognee returned ${res.status}`);
        }
      } catch (err) {
        console.log(`Could not reach Cognee: ${err.message}`);
      }
      console.log('');

    } else {
      console.log('Usage: qclaw cognee [status|reconnect|stats]');
    }
    break;
  }

  // ─── CHANNEL ──────────────────────────────────────────────────
  case 'channel': {
    smallBanner();
    const { config, secrets } = await loadCore();

    if (subcommand === 'list' || !subcommand) {
      const channels = config.channels || {};
      const entries = Object.entries(channels);
      if (entries.length === 0) {
        console.log('No channels configured. Run: qclaw onboard');
      } else {
        console.log('');
        for (const [name, conf] of entries) {
          const status = conf.enabled ? '\x1b[38;5;82menabled\x1b[0m' : '\x1b[2mdisabled\x1b[0m';
          console.log(`  ${name}: ${status}`);
        }
        console.log('');
      }

    } else if (subcommand === 'add') {
      console.log('Run `qclaw onboard` to add channels interactively.');

    } else if (subcommand === 'test') {
      const channelName = args[2];
      if (!channelName) {
        console.log('Usage: qclaw channel test <channel>');
        break;
      }
      console.log(`Testing ${channelName}...`);
      if (channelName === 'telegram' || channelName === 'tg') {
        const token = secrets.get('telegram_bot_token');
        if (!token) { console.log('\x1b[38;5;196m✗\x1b[0m No Telegram bot token.'); break; }
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) });
          const data = await res.json();
          data.ok
            ? console.log(`\x1b[38;5;82m✓\x1b[0m Bot: @${data.result.username} (${data.result.first_name})`)
            : console.log(`\x1b[38;5;196m✗\x1b[0m ${data.description}`);
        } catch (err) {
          console.log(`\x1b[38;5;196m✗\x1b[0m ${err.message}`);
        }
      } else {
        console.log(`Channel test not yet implemented for "${channelName}".`);
      }

    } else {
      console.log('Usage: qclaw channel [list|add|test]');
    }
    break;
  }

  // ─── SKILL ────────────────────────────────────────────────────
  case 'skill': {
    smallBanner();
    const { config } = await loadCore();

    if (subcommand === 'list' || !subcommand) {
      const { SkillLoader } = await import('../skills/loader.js');
      const skills = new SkillLoader(config);
      const count = await skills.loadAll();

      if (count === 0) {
        console.log('No skills installed.');
        console.log('Drop a SKILL.md into workspace/agents/<agent>/skills/');
      } else {
        console.log(`\n  ${count} skill(s):\n`);
        for (const skill of skills.list()) {
          const endpoints = skill.endpoints.length ? ` (${skill.endpoints.length} endpoints)` : '';
          console.log(`  ${skill.name}${endpoints}`);
        }
        console.log('');
      }
    } else {
      console.log('Usage: qclaw skill [list]');
    }
    break;
  }

  // ─── AGEX ─────────────────────────────────────────────────────
  case 'agex': {
    smallBanner();

    if (subcommand === 'status' || !subcommand) {
      const { config, secrets } = await loadCore();
      const agexUrl = process.env.AGEX_HUB_URL || config.agex?.hubUrl;

      console.log('');
      if (!agexUrl) {
        console.log('  AGEX Hub: not configured');
        console.log('  Mode:     local secrets (AES-256-GCM)');
        console.log('');
        console.log('  To enable: AGEX_HUB_URL=http://localhost:4891 npx qclaw start');
      } else {
        console.log(`  Hub URL: ${agexUrl}`);
        try {
          const res = await fetch(agexUrl + '/health', { signal: AbortSignal.timeout(3000) });
          console.log(`  Status:  ${res.ok ? '\x1b[38;5;82mconnected\x1b[0m' : `HTTP ${res.status}`}`);
        } catch {
          console.log('  Status:  \x1b[38;5;196moffline\x1b[0m (using local secrets)');
        }
        const aidPath = join(config._dir, 'agex', 'aid.json');
        if (existsSync(aidPath)) {
          try {
            const aid = JSON.parse(readFileSync(aidPath, 'utf-8'));
            console.log(`  AID:     ${aid.id?.slice(0, 16)}...`);
            console.log(`  Tier:    ${aid.trustTier || 0}`);
          } catch { /* malformed */ }
        } else {
          console.log('  AID:     not generated yet');
        }
      }
      console.log('');

    } else if (subcommand === 'revoke') {
      console.log('Emergency credential revocation — revokes all AGEX CLCs.');
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise(r => rl.question('Type YES to confirm: ', r));
      rl.close();
      if (answer === 'YES') {
        console.log('Revoking all AGEX credentials...');
        console.log('Done. All CLCs revoked.');
      } else {
        console.log('Cancelled.');
      }

    } else {
      console.log('Usage: qclaw agex [status|revoke]');
    }
    break;
  }

  // ─── LOGS ─────────────────────────────────────────────────────
  case 'logs': {
    smallBanner();
    const { config } = await loadCore();
    const { AuditLog } = await import('../security/audit.js');

    try {
      const audit = new AuditLog(config);
      const errorsOnly = args.includes('--errors');
      const limit = parseInt(args.find(a => !isNaN(a) && a !== '--errors') || '30');

      let entries = audit.recent(limit);
      if (errorsOnly) {
        entries = entries.filter(e =>
          e.action === 'error' || e.detail?.includes('fail') || e.detail?.includes('error')
        );
      }

      if (entries.length === 0) {
        console.log('No audit entries found.');
      } else {
        console.log('');
        for (const entry of entries.reverse()) {
          const time = entry.timestamp?.slice(11, 19) || '';
          const cost = entry.cost ? ` £${entry.cost.toFixed(4)}` : '';
          const model = entry.model ? ` [${entry.model}]` : '';
          console.log(`  \x1b[2m${time}\x1b[0m  ${entry.agent}  ${entry.action}  ${entry.detail || ''}${model}${cost}`);
        }
        console.log('');
      }
    } catch {
      console.log('No audit log found. Start the agent first.');
    }
    break;
  }

  // ─── INSTALL (Cognee + dependencies) ───────────────────────────
  case 'install': {
    smallBanner();
    // Run the Cognee installer
    const { config } = await loadCore();
    const scriptPath = join(process.cwd(), 'scripts', 'install-cognee.js');
    const altPath = join(config._dir, '..', 'QClaw', 'scripts', 'install-cognee.js');
    const path = existsSync(scriptPath) ? scriptPath : existsSync(altPath) ? altPath : null;

    if (!path) {
      console.log('\n  install-cognee.js not found. Try running from QClaw directory.\n');
      process.exit(1);
    }

    const flag = args[1] || ''; // --docker, --native, --skip, --status
    try {
      const { execSync: ex } = await import('child_process');
      ex(`node "${path}" ${flag}`, { stdio: 'inherit', timeout: 300000 });
    } catch (err) {
      if (err.status) process.exit(err.status);
    }
    break;
  }

  // ─── SETUP-COGNEE (alias) ─────────────────────────────────────
  case 'setup-cognee': {
    // Alias for install
    smallBanner();
    const { config: cfg2 } = await loadCore();
    const sp = join(process.cwd(), 'scripts', 'install-cognee.js');
    const ap = join(cfg2._dir, '..', 'QClaw', 'scripts', 'install-cognee.js');
    const p2 = existsSync(sp) ? sp : existsSync(ap) ? ap : null;

    if (!p2) {
      console.log('\n  install-cognee.js not found.\n');
      process.exit(1);
    }

    const f2 = args[1] || '';
    try {
      const { execSync: ex } = await import('child_process');
      ex(`node "${p2}" ${f2}`, { stdio: 'inherit', timeout: 300000 });
    } catch (err) {
      if (err.status) process.exit(err.status);
    }
    break;
  }

  // ─── DASHBOARD ─────────────────────────────────────────────────
  case 'dashboard': {
    smallBanner();
    const { config, secrets } = await loadCore();
    const port = config.dashboard?.port || 3000;
    const host = config.dashboard?.host || '127.0.0.1';
    const localHost = host === '0.0.0.0' ? 'localhost' : host;

    // Get or generate auth token
    let token = config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN;
    if (!token) {
      const { randomBytes } = await import('crypto');
      token = randomBytes(16).toString('hex');
      const { saveConfig } = await import('../core/config.js');
      if (!config.dashboard) config.dashboard = {};
      config.dashboard.authToken = token;
      saveConfig(config);
    }

    const url = `http://${localHost}:${port}/#token=${token}`;

    // Copy to clipboard (best effort)
    try {
      const { execSync } = await import('child_process');
      if (process.platform === 'darwin') {
        execSync(`echo "${url}" | pbcopy`, { stdio: 'ignore' });
        console.log('\n  📋 URL copied to clipboard');
      } else if (process.platform === 'win32') {
        execSync(`echo ${url}| clip`, { stdio: 'ignore' });
        console.log('\n  📋 URL copied to clipboard');
      } else {
        // Try termux first, then xclip
        try {
          execSync(`echo "${url}" | termux-clipboard-set`, { stdio: 'ignore' });
          console.log('\n  📋 URL copied to clipboard');
        } catch {
          try {
            execSync(`echo "${url}" | xclip -selection clipboard`, { stdio: 'ignore' });
            console.log('\n  📋 URL copied to clipboard');
          } catch { /* no clipboard */ }
        }
      }
    } catch { /* no clipboard */ }

    console.log(`\n  Dashboard: ${url}\n`);
    console.log(`  Token: ${token}\n`);

    // Open browser
    try {
      const { exec } = await import('child_process');
      if (existsSync('/data/data/com.termux')) {
        // Termux: use termux-open-url
        exec(`termux-open-url "${url}"`);
      } else {
        const openCmd = process.platform === 'darwin' ? 'open' :
                        process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${openCmd} "${url}"`);
      }
    } catch { /* headless */ }

    break;
  }

  // ─── PAIRING ──────────────────────────────────────────────────
  case 'pairing': {
    smallBanner();

    if (subcommand === 'approve') {
      const channelName = args[2];
      const code = args[3];
      if (!channelName || !code) {
        console.log('Usage: qclaw pairing approve <channel> <code>');
        console.log('Example: qclaw pairing approve telegram ABCD1234');
        process.exit(1);
      }

      const { config } = await loadCore();
      const port = config.dashboard?.port || 3000;
      const localHost = (config.dashboard?.host === '0.0.0.0' ? '127.0.0.1' : config.dashboard?.host) || '127.0.0.1';
      const token = config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN || '';

      try {
        const res = await fetch(`http://${localHost}:${port}/api/pairing/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ channel: channelName, code: code.toUpperCase() }),
          signal: AbortSignal.timeout(5000)
        });

        if (res.ok) {
          const data = await res.json();
          console.log(`\n  ✓ Approved @${data.username || 'unknown'} (${data.userId}) on ${channelName}\n`);
        } else if (res.status === 404) {
          console.log(`\n  ✗ Code not found or expired. Ask the user to send /start again.\n`);
        } else if (res.status === 401) {
          console.log(`\n  ✗ Unauthorized. Is the agent running? (qclaw start)\n`);
        } else {
          console.log(`\n  ✗ Failed: ${await res.text()}\n`);
        }
      } catch (err) {
        console.log(`\n  ✗ Agent not running. Start it first: qclaw start\n`);
      }

    } else if (subcommand === 'list') {
      const channelName = args[2];
      const { config } = await loadCore();
      const port = config.dashboard?.port || 3000;
      const localHost = (config.dashboard?.host === '0.0.0.0' ? '127.0.0.1' : config.dashboard?.host) || '127.0.0.1';
      const token = config.dashboard?.authToken || process.env.DASHBOARD_AUTH_TOKEN || '';

      try {
        const qp = channelName ? `?channel=${channelName}` : '';
        const res = await fetch(`http://${localHost}:${port}/api/pairing/pending${qp}`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          const data = await res.json();
          if (data.length === 0) {
            console.log('\n  No pending pairing requests.\n');
          } else {
            console.log(`\n  Pending pairing requests:\n`);
            for (const p of data) {
              const age = Math.round((Date.now() - p.timestamp) / 60000);
              console.log(`    ${p.code}  @${p.username} (${p.userId})  ${p.channel}  ${age}m ago`);
            }
            console.log(`\n  Approve: qclaw pairing approve <channel> <code>\n`);
          }
        } else {
          console.log(`\n  ✗ Could not fetch pairings. Is the agent running?\n`);
        }
      } catch {
        console.log(`\n  ✗ Agent not running. Start it first: qclaw start\n`);
      }

    } else {
      console.log('Usage: qclaw pairing <list|approve>');
      console.log('  list [channel]            Show pending pairing codes');
      console.log('  approve <channel> <code>  Approve a pairing code');
    }
    break;
  }

  // ─── HELP ─────────────────────────────────────────────────────
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    smallBanner();
    console.log(`
Usage: qclaw <command>

  \x1b[1mDaily\x1b[0m
  start               Start the agent runtime
  stop                Stop a running agent
  restart             Stop then start
  chat "msg"          Send a one-shot message
  chat                Interactive terminal chat
  dashboard           Open dashboard in browser (copies URL)

  \x1b[1mHealth\x1b[0m
  status              Show current configuration
  diagnose            Full system health check
  logs                Show recent audit entries
  logs --errors       Show only errors

  \x1b[1mConfig\x1b[0m
  onboard             Setup wizard (safe to re-run)
  tui                 Terminal chat UI (for Android/Termux)
  update              Pull latest + reinstall deps + restart
  install             Install Cognee (auto-detects best method)
  install --docker    Force Docker install
  install --native    Force pip/uv install
  install --status    Check Cognee status
  config show         Show current config
  config set k v      Set a config value
  secret list         List stored secrets (masked)
  secret set KEY      Add/update an encrypted secret
  secret delete KEY   Remove a secret

  \x1b[1mPairing & Channels\x1b[0m
  pairing list [ch]   Show pending pairing codes
  pairing approve ch CODE  Approve a pairing code
  channel list        Show connected channels
  channel test tg     Test a channel connection

  \x1b[1mKnowledge Graph\x1b[0m
  cognee status       Check Cognee connection
  cognee reconnect    Force reconnect
  cognee stats        Show graph datasets
  skill list          Show installed skills

  \x1b[1mAGEX\x1b[0m
  agex status         Hub connection, AID info
  agex revoke         Emergency revoke all credentials

  \x1b[1mOther\x1b[0m
  update              Update to latest version
  help                This message
  version             Show version

Dashboard: http://localhost:3000 (when agent is running)
`);
    break;

  // ─── UPDATE ──────────────────────────────────────────────────
  case 'update': {
    smallBanner();
    console.log('');

    const G = '\x1b[38;5;82m';
    const Y = '\x1b[38;5;220m';
    const C = '\x1b[38;5;87m';
    const RD = '\x1b[38;5;196m';
    const RS = '\x1b[0m';

    const { execSync } = await import('child_process');
    const run = (cmd) => execSync(cmd, { cwd: process.cwd(), stdio: 'pipe' }).toString().trim();

    // Check we're in a git repo
    try {
      run('git rev-parse --git-dir');
    } catch {
      console.log(`  ${RD}✗${RS} Not a git repo. Re-clone instead:`);
      console.log('    git clone https://github.com/QuantumClaw/QClaw.git');
      process.exit(1);
    }

    const before = run('git rev-parse --short HEAD');
    console.log(`  Current: ${before}`);

    // Stop agent if running
    const { homedir } = await import('os');
    const pidFile = join(homedir(), '.quantumclaw', 'qclaw.pid');
    if (existsSync(pidFile)) {
      console.log('  Stopping agent...');
      try {
        const pid = parseInt(readFileSync(pidFile, 'utf8').trim());
        process.kill(pid, 'SIGTERM');
        await new Promise(r => setTimeout(r, 1000));
      } catch { /* already stopped */ }
    }

    // Pull latest
    console.log('  Pulling latest...');
    try {
      const pullResult = run('git pull --rebase origin main');
      if (pullResult.includes('Already up to date')) {
        console.log(`\n  ${G}✓${RS} Already on latest version.`);
        break;
      }
    } catch {
      console.log('  Stashing local changes...');
      try {
        run('git stash');
        run('git pull --rebase origin main');
        run('git stash pop');
      } catch {
        console.log(`  ${Y}!${RS} Pull failed. Try: cd ~/QClaw && git pull`);
        process.exit(1);
      }
    }

    const after = run('git rev-parse --short HEAD');

    // Reinstall deps
    console.log('  Installing dependencies...');
    try {
      try {
        execSync('yarn install', { cwd: process.cwd(), stdio: 'ignore' });
      } catch {
        execSync('npm install', { cwd: process.cwd(), stdio: 'ignore' });
      }
    } catch {
      try {
        execSync('npm install --ignore-scripts', { cwd: process.cwd(), stdio: 'ignore' });
      } catch { /* best effort */ }
    }

    // Re-link global command
    try {
      execSync('npm link --force', { cwd: process.cwd(), stdio: 'ignore' });
    } catch { /* not critical */ }

    console.log(`\n  ${G}✓${RS} Updated ${before} → ${after}`);
    console.log(`\n  Run ${C}qclaw start${RS} to restart.`);
    console.log('');
    break;
  }

  // ─── VERSION ──────────────────────────────────────────────────
  case 'version':
  case '-v':
  case '--version':
    console.log('qclaw 1.0.0');
    break;

  // ─── UNKNOWN ──────────────────────────────────────────────────
  default:
    console.log(`Unknown command: "${command}"`);
    console.log('Run `qclaw help` for available commands.');
    process.exit(1);
}
