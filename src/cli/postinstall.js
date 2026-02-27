#!/usr/bin/env node

/**
 * QuantumClaw Post-Install Verification
 *
 * Runs automatically after `npm install`.
 * Checks all critical dependencies are loadable.
 * Exits 0 even on failure (install must not break),
 * but prints clear warnings so the user knows what's missing.
 */

const checks = [
  { name: '@agexhq/core',     pkg: '@agexhq/core',     critical: true,  what: 'AGEX protocol (crypto, schemas)' },
  { name: '@agexhq/sdk',      pkg: '@agexhq/sdk',      critical: true,  what: 'AGEX Agent SDK (identity + credentials)' },
  { name: '@agexhq/hub-lite', pkg: '@agexhq/hub-lite',  critical: true,  what: 'AGEX Hub Lite (local credential hub)' },
  { name: '@agexhq/store',    pkg: '@agexhq/store',     critical: true,  what: 'AGEX storage (SQLite backend)' },
  { name: 'express',          pkg: 'express',           critical: true,  what: 'Dashboard web server' },
  { name: 'grammy',           pkg: 'grammy',            critical: false, what: 'Telegram bot framework' },
  { name: 'better-sqlite3',   pkg: 'better-sqlite3',    critical: false, what: 'Native SQLite (faster audit/memory)' },
];

const green = '\x1b[32m';
const yellow = '\x1b[33m';
const red = '\x1b[31m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';
const bold = '\x1b[1m';

async function verify() {
  console.log(`\n${dim}── QuantumClaw dependency check ──${reset}\n`);

  let passed = 0;
  let warned = 0;
  let failed = 0;

  for (const check of checks) {
    try {
      await import(check.pkg);
      console.log(`  ${green}✓${reset} ${check.name} ${dim}— ${check.what}${reset}`);
      passed++;
    } catch (err) {
      if (check.critical) {
        console.log(`  ${red}✗${reset} ${check.name} ${dim}— ${check.what}${reset}`);
        console.log(`    ${red}MISSING: ${err.message.split('\n')[0]}${reset}`);
        failed++;
      } else {
        console.log(`  ${yellow}○${reset} ${check.name} ${dim}— ${check.what} (optional)${reset}`);
        warned++;
      }
    }
  }

  console.log('');

  if (failed > 0) {
    console.log(`${red}${bold}  ⚠ ${failed} critical package(s) failed to install.${reset}`);
    console.log(`${dim}  Try: rm -rf node_modules && npm install${reset}`);
    console.log(`${dim}  If @agexhq packages fail, check: npm view @agexhq/core version${reset}`);
    console.log('');
  } else if (warned > 0) {
    console.log(`${green}  ✓ All critical packages installed.${reset} ${dim}${warned} optional skipped.${reset}`);
    console.log('');
  } else {
    console.log(`${green}  ✓ All packages installed. AGEX identity system ready.${reset}`);
    console.log('');
  }

  // Verify AGEX SDK can actually create an AID (the key test)
  try {
    const { AgexClient } = await import('@agexhq/sdk');
    const { aid } = await AgexClient.generateAID({ agentName: 'postinstall-test' });
    if (aid?.aid_id) {
      console.log(`${green}  ✓ AGEX crypto working — test AID: ${aid.aid_id.slice(0, 8)}...${reset}`);
    }
  } catch (err) {
    if (failed === 0) {
      console.log(`${yellow}  ○ AGEX SDK loaded but crypto check failed: ${err.message.split('\n')[0]}${reset}`);
    }
  }

  console.log('');
}

verify().catch(() => {
  // Never fail the install
  process.exit(0);
});
