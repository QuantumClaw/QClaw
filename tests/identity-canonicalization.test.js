/**
 * Identity-canonicalization gate tests.
 *
 * Run: node tests/identity-canonicalization.test.js
 *
 * Slice 1 followup #6 makes runtime identity files (SOUL/VALUES/IDENTITY)
 * symlinks pointing at the repo. After symlinking, runtime writers must
 * refuse to write through the link — otherwise they'd silently mutate
 * the canonical repo file. These tests cover the two writers that exist
 * today: dashboard PUT /api/agents/:name/soul and TrustKernel.load()'s
 * default-VALUES path.
 */

import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync,
  symlinkSync, statSync, lstatSync, rmSync, existsSync
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TrustKernel } from '../src/security/trust-kernel.js';

let passed = 0;
let failed = 0;
function check(label, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}

// ─── TrustKernel: default-write refuses through a symlink ──────────────
async function testTrustKernelSymlinkRefuse() {
  const tmp = mkdtempSync(join(tmpdir(), 'qclaw-tk-symlink-'));
  // Repo-side target the runtime symlink will point at.
  const repoFile = join(tmp, 'repo', 'VALUES.md');
  mkdirSync(join(tmp, 'repo'), { recursive: true });
  writeFileSync(repoFile, '# canonical VALUES\n## Hard Rules\n- nothing\n## Soft Rules\n- nothing\n## Forbidden\n- nothing\n');
  const repoMtimeBefore = statSync(repoFile).mtimeMs;

  // Runtime _dir with VALUES.md as a symlink to the repo file.
  const runtimeDir = join(tmp, 'runtime');
  mkdirSync(runtimeDir, { recursive: true });
  symlinkSync(repoFile, join(runtimeDir, 'VALUES.md'));

  // Healthy-symlink case: load() should succeed, no write, content from repo.
  const kernelHealthy = new TrustKernel({ _dir: runtimeDir });
  await kernelHealthy.load();
  check('TrustKernel: healthy symlink → load() reads repo content',
    kernelHealthy.raw.includes('canonical VALUES'));
  check('TrustKernel: healthy symlink → repo file untouched (mtime unchanged)',
    statSync(repoFile).mtimeMs === repoMtimeBefore);

  // Dangling-symlink case: delete the target after the symlink is in place,
  // then call load() — should refuse the default write, leave nothing at the
  // dangling target, and propagate the readFileSync ENOENT (load() throws).
  rmSync(repoFile);
  const kernelDangling = new TrustKernel({ _dir: runtimeDir });
  let threw = false;
  try { await kernelDangling.load(); } catch (e) { threw = true; }
  check('TrustKernel: dangling symlink → load() throws (ENOENT propagated)', threw);
  // The critical assertion: the dangling target was NOT recreated with DEFAULT_VALUES.
  check('TrustKernel: dangling symlink → repo target NOT recreated', !existsSync(repoFile));

  rmSync(tmp, { recursive: true, force: true });
}

// ─── Dashboard PUT gate: lstat detects symlinks; gate refuses to write ──
// We don't spin up the full dashboard for this test — the gate logic is
// a 3-line conditional on lstatSync().isSymbolicLink(). Mirror that
// conditional directly against a symlinked fixture and against a regular
// fixture to confirm the discrimination.
function testDashboardSymlinkGate() {
  const tmp = mkdtempSync(join(tmpdir(), 'qclaw-dash-symlink-'));
  const repoSoul = join(tmp, 'repo', 'SOUL.md');
  mkdirSync(join(tmp, 'repo'), { recursive: true });
  writeFileSync(repoSoul, '# canonical SOUL\n');
  const repoBytesBefore = readFileSync(repoSoul, 'utf-8');
  const repoMtimeBefore = statSync(repoSoul).mtimeMs;

  const charlieDir = join(tmp, 'runtime', 'workspace', 'agents', 'charlie');
  mkdirSync(charlieDir, { recursive: true });
  symlinkSync(repoSoul, join(charlieDir, 'SOUL.md'));

  // Mirror of the gate logic in src/dashboard/server.js PUT handler.
  function dashboardPutSoulGate(soulPath, content) {
    const lstat = lstatSync(soulPath, { throwIfNoEntry: false });
    if (lstat?.isSymbolicLink()) {
      return { status: 409, body: { error: 'This identity file is canonicalized to the repo. Edit via git.' } };
    }
    writeFileSync(soulPath, content);
    return { status: 200, body: { ok: true } };
  }

  // Charlie SOUL is a symlink → expect 409, repo file untouched.
  const charlieResult = dashboardPutSoulGate(join(charlieDir, 'SOUL.md'), '# malicious overwrite\n');
  check('Dashboard gate: symlinked SOUL → 409', charlieResult.status === 409);
  check('Dashboard gate: 409 body matches spec',
    charlieResult.body?.error === 'This identity file is canonicalized to the repo. Edit via git.');
  check('Dashboard gate: repo file unchanged (content)',
    readFileSync(repoSoul, 'utf-8') === repoBytesBefore);
  check('Dashboard gate: repo file unchanged (mtime)',
    statSync(repoSoul).mtimeMs === repoMtimeBefore);

  // Negative: regular (non-symlink) sub-agent SOUL → gate allows write.
  const subAgentDir = join(tmp, 'runtime', 'workspace', 'agents', 'sub-agent');
  mkdirSync(subAgentDir, { recursive: true });
  writeFileSync(join(subAgentDir, 'SOUL.md'), '# regular SOUL\n');
  const subResult = dashboardPutSoulGate(join(subAgentDir, 'SOUL.md'), '# updated SOUL\n');
  check('Dashboard gate: regular SOUL → 200', subResult.status === 200);
  check('Dashboard gate: regular SOUL → write occurred',
    readFileSync(join(subAgentDir, 'SOUL.md'), 'utf-8') === '# updated SOUL\n');

  rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  await testTrustKernelSymlinkRefuse();
  testDashboardSymlinkGate();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
