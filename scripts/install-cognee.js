#!/usr/bin/env node

/**
 * QuantumClaw — Cognee Auto-Installer
 *
 * Runs as part of `qclaw install` or automatically during first setup.
 * Tries every available method to get Cognee running:
 *
 *   1. Docker (preferred — isolation, restart policy, cleanest)
 *   2. uv (fast modern Python package manager)
 *   3. pip3 / pip (universal fallback)
 *   4. pipx (isolated Python app install)
 *   5. poetry (if project already uses it)
 *
 * Usage:
 *   node scripts/install-cognee.js              # auto-detect best method
 *   node scripts/install-cognee.js --docker     # force Docker
 *   node scripts/install-cognee.js --native     # force pip/uv (skip Docker)
 *   node scripts/install-cognee.js --skip       # mark as skipped, use local memory
 *   node scripts/install-cognee.js --status     # check if Cognee is running
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Config ──────────────────────────────────────────────────────
const COGNEE_PORT = 8000;
const COGNEE_CONTAINER = 'quantumclaw-cognee';
const COGNEE_IMAGE = 'cognee/cognee:latest';
const CONFIG_DIR = join(homedir(), '.quantumclaw');
const HEALTH_URL = `http://localhost:${COGNEE_PORT}/health`;
const MAX_HEALTH_WAIT = 45; // seconds

// ─── ANSI ────────────────────────────────────────────────────────
const G = '\x1b[38;5;82m';
const Y = '\x1b[38;5;220m';
const R = '\x1b[38;5;196m';
const C = '\x1b[38;5;117m';
const D = '\x1b[2m';
const B = '\x1b[1m';
const RS = '\x1b[0m';

const ok   = (m) => console.log(`  ${G}✓${RS} ${m}`);
const warn = (m) => console.log(`  ${Y}!${RS} ${m}`);
const fail = (m) => console.log(`  ${R}✗${RS} ${m}`);
const info = (m) => console.log(`  ${D}${m}${RS}`);

// ─── Helpers ─────────────────────────────────────────────────────
function has(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { return false; }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', timeout: opts.timeout || 30000, ...opts }).trim();
}

async function waitForHealth(seconds = MAX_HEALTH_WAIT) {
  for (let i = 0; i < seconds; i++) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

async function isRunning() {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

function getEnvVars() {
  // Read LLM key from QuantumClaw config or env
  let llmKey = process.env.LLM_API_KEY || '';
  try {
    const configFile = join(CONFIG_DIR, 'config.json');
    if (existsSync(configFile)) {
      const config = JSON.parse(readFileSync(configFile, 'utf-8'));
      const provider = config.models?.primary?.provider;
      if (provider) {
        // Try to read from secrets (encrypted) — we can't decrypt here,
        // so fall through to env vars or ask during onboarding
      }
    }
  } catch { /* config not ready yet — fine */ }

  return {
    LLM_API_KEY: llmKey,
    VECTOR_DB_PROVIDER: 'lancedb',
    ENABLE_BACKEND_ACCESS_CONTROL: 'false',
  };
}

function saveInstallMethod(method) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const metaFile = join(CONFIG_DIR, 'cognee-install.json');
  writeFileSync(metaFile, JSON.stringify({
    method,
    installedAt: new Date().toISOString(),
    port: COGNEE_PORT,
    container: method === 'docker' ? COGNEE_CONTAINER : null,
  }, null, 2));
}

// ─── Install Methods ─────────────────────────────────────────────

async function installDocker() {
  console.log(`\n  ${B}Installing Cognee via Docker${RS}`);

  // Pull image
  info('Pulling cognee/cognee:latest ...');
  try {
    execSync(`docker pull ${COGNEE_IMAGE}`, { stdio: 'inherit', timeout: 180000 });
  } catch (err) {
    fail(`Docker pull failed: ${err.message}`);
    return false;
  }

  // Remove existing container if any
  try { run(`docker rm -f ${COGNEE_CONTAINER}`); } catch { /* doesn't exist */ }

  // Start container
  const env = getEnvVars();
  const envFlags = Object.entries(env)
    .filter(([, v]) => v)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(' ');

  try {
    run(
      `docker run -d ` +
      `--name ${COGNEE_CONTAINER} ` +
      `--restart unless-stopped ` +
      `-p ${COGNEE_PORT}:8000 ` +
      `${envFlags} ` +
      `-v quantumclaw-cognee-data:/app/cognee/.cognee_system ` +
      `${COGNEE_IMAGE}`,
      { timeout: 30000 }
    );
  } catch (err) {
    fail(`Docker run failed: ${err.message}`);
    return false;
  }

  // Wait for health
  info('Waiting for Cognee to start...');
  const healthy = await waitForHealth();
  if (healthy) {
    ok('Cognee running (Docker)');
    saveInstallMethod('docker');
    return true;
  }

  warn('Container started but health check not responding yet');
  info('It may need another minute. Check: docker logs quantumclaw-cognee');
  saveInstallMethod('docker');
  return true; // optimistic — container is running
}

async function installNative(packageManager) {
  console.log(`\n  ${B}Installing Cognee via ${packageManager}${RS}`);

  const isTermux = existsSync('/data/data/com.termux/files/usr/bin/bash');
  const breakFlag = (packageManager === 'pip3' || packageManager === 'pip') && !isTermux
    ? '--break-system-packages' : '';

  // Build install command based on package manager
  let installCmd;
  switch (packageManager) {
    case 'uv':
      installCmd = 'uv pip install cognee';
      break;
    case 'pipx':
      installCmd = 'pipx install cognee';
      break;
    case 'poetry':
      // Poetry needs a project context — create a minimal one
      const cogneeDir = join(CONFIG_DIR, 'cognee-env');
      mkdirSync(cogneeDir, { recursive: true });
      if (!existsSync(join(cogneeDir, 'pyproject.toml'))) {
        writeFileSync(join(cogneeDir, 'pyproject.toml'), `[tool.poetry]
name = "quantumclaw-cognee"
version = "0.1.0"
description = "Cognee for QuantumClaw"
[tool.poetry.dependencies]
python = "^3.10"
cognee = "*"
`);
      }
      installCmd = `cd "${cogneeDir}" && poetry install`;
      break;
    case 'pip3':
      installCmd = `pip3 install cognee ${breakFlag}`;
      break;
    case 'pip':
    default:
      installCmd = `pip install cognee ${breakFlag}`;
      break;
  }

  info(`Running: ${installCmd}`);
  try {
    execSync(installCmd, { stdio: 'inherit', timeout: 180000 });
  } catch (err) {
    fail(`Install failed: ${err.message}`);
    return false;
  }

  ok(`Cognee installed via ${packageManager}`);

  // Start the Cognee API server
  info('Starting Cognee API server...');
  const env = getEnvVars();

  // Find the right Python/runner
  let serverCmd, serverArgs;
  if (packageManager === 'uv') {
    serverCmd = 'uv';
    serverArgs = ['run', 'python', '-m', 'uvicorn', 'cognee.api.server:app', '--host', '0.0.0.0', '--port', String(COGNEE_PORT)];
  } else if (packageManager === 'pipx') {
    // pipx installs into its own env — need to find the binary
    serverCmd = 'cognee';
    serverArgs = ['server', '--port', String(COGNEE_PORT)];
  } else {
    // pip/pip3/poetry — use python -m
    const python = has('python3') ? 'python3' : 'python';
    serverCmd = python;
    serverArgs = ['-m', 'uvicorn', 'cognee.api.server:app', '--host', '0.0.0.0', '--port', String(COGNEE_PORT)];
  }

  const proc = spawn(serverCmd, serverArgs, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ...env }
  });
  proc.unref();

  // Save PID for later management
  try {
    writeFileSync(join(CONFIG_DIR, 'cognee.pid'), String(proc.pid));
  } catch { /* best effort */ }

  // Wait for health
  info('Waiting for Cognee to start...');
  const healthy = await waitForHealth(30);
  if (healthy) {
    ok('Cognee running (native)');
    saveInstallMethod(packageManager);
    return true;
  }

  warn('Cognee installed but API server not responding');
  info(`Try manually: ${serverCmd} ${serverArgs.join(' ')}`);
  saveInstallMethod(packageManager);
  return false;
}

// ─── Detection ───────────────────────────────────────────────────

function detectAvailableManagers() {
  const managers = [];

  // Docker (preferred)
  if (has('docker')) {
    // Check Docker daemon is actually running
    try {
      run('docker info', { timeout: 5000 });
      managers.push({ name: 'docker', priority: 1 });
    } catch {
      // Docker installed but daemon not running
    }
  }

  // Python package managers (in preference order)
  if (has('uv'))      managers.push({ name: 'uv',      priority: 2 });
  if (has('pip3'))     managers.push({ name: 'pip3',    priority: 3 });
  if (has('pip'))      managers.push({ name: 'pip',     priority: 4 });
  if (has('pipx'))     managers.push({ name: 'pipx',    priority: 5 });
  if (has('poetry'))   managers.push({ name: 'poetry',  priority: 6 });

  return managers.sort((a, b) => a.priority - b.priority);
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const flag = process.argv[2];

  console.log(`\n  ${B}QuantumClaw — Cognee Setup${RS}\n`);

  // --status: just check if running
  if (flag === '--status') {
    const running = await isRunning();
    if (running) {
      ok(`Cognee is running on port ${COGNEE_PORT}`);
      // Show install method
      try {
        const meta = JSON.parse(readFileSync(join(CONFIG_DIR, 'cognee-install.json'), 'utf-8'));
        info(`Installed via: ${meta.method} (${meta.installedAt})`);
      } catch { /* no meta */ }
    } else {
      warn('Cognee is not running');
    }
    process.exit(running ? 0 : 1);
  }

  // --skip: disable Cognee
  if (flag === '--skip') {
    warn('Cognee skipped — using local memory only');
    saveInstallMethod('skipped');
    process.exit(0);
  }

  // Check if already running
  if (await isRunning()) {
    ok('Cognee already running');
    process.exit(0);
  }

  // Check if container exists but stopped
  if (has('docker')) {
    try {
      const containers = run(`docker ps -a --filter name=${COGNEE_CONTAINER} --format "{{.Status}}"`);
      if (containers && containers.includes('Exited')) {
        info('Found stopped Cognee container — restarting...');
        run(`docker start ${COGNEE_CONTAINER}`);
        if (await waitForHealth(15)) {
          ok('Cognee restarted (Docker)');
          process.exit(0);
        }
      }
    } catch { /* no container */ }
  }

  // Detect available install methods
  const managers = detectAvailableManagers();

  if (managers.length === 0) {
    fail('No Docker, pip, uv, pipx, or poetry found');
    info('Install Docker: https://docs.docker.com/get-docker/');
    info('Or install Python 3.10+: https://python.org');
    warn('Agent will use local SQLite memory (no knowledge graph)');
    saveInstallMethod('unavailable');
    process.exit(1);
  }

  // --docker: force Docker
  if (flag === '--docker') {
    if (!managers.find(m => m.name === 'docker')) {
      fail('Docker not available or daemon not running');
      process.exit(1);
    }
    const success = await installDocker();
    process.exit(success ? 0 : 1);
  }

  // --native: force pip/uv (skip Docker)
  if (flag === '--native') {
    const native = managers.filter(m => m.name !== 'docker');
    if (native.length === 0) {
      fail('No Python package manager found');
      process.exit(1);
    }
    const success = await installNative(native[0].name);
    process.exit(success ? 0 : 1);
  }

  // Auto mode: try each method in priority order
  info(`Available: ${managers.map(m => m.name).join(', ')}`);
  info(`Trying: ${managers[0].name} (best available)\n`);

  for (const manager of managers) {
    let success;
    if (manager.name === 'docker') {
      success = await installDocker();
    } else {
      success = await installNative(manager.name);
    }

    if (success) {
      console.log('');
      process.exit(0);
    }

    // Failed — try next method
    if (managers.indexOf(manager) < managers.length - 1) {
      warn(`${manager.name} failed, trying next method...`);
    }
  }

  // All methods failed
  console.log('');
  fail('All install methods failed');
  warn('Agent will use local SQLite memory (no knowledge graph)');
  info('You can retry later: node scripts/install-cognee.js');
  saveInstallMethod('failed');
  process.exit(1);
}

main().catch(err => {
  fail(`Unexpected error: ${err.message}`);
  process.exit(1);
});
