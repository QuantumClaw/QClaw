/**
 * Smoke test — verifies all core modules can be imported without errors.
 * Run with: node tests/smoke.test.js
 */

const modules = [
  '../src/core/config.js',
  '../src/core/logger.js',
  '../src/core/heartbeat.js',
  '../src/core/delivery-queue.js',
  '../src/core/completion-cache.js',
  '../src/security/secrets.js',
  '../src/security/trust-kernel.js',
  '../src/security/audit.js',
  '../src/security/approvals.js',
  '../src/memory/manager.js',
  '../src/models/router.js',
  '../src/agents/registry.js',
  '../src/skills/loader.js',
  '../src/channels/manager.js',
  '../src/dashboard/server.js',
  '../src/credentials.js',
  '../src/agex-sdk/crypto.js'
];

let passed = 0;
let failed = 0;

for (const mod of modules) {
  try {
    await import(mod);
    console.log(`  ✓ ${mod}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${mod}: ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
