/**
 * QuantumClaw — shell_exec spawn wrapper (Slice 3d)
 *
 * Pure spawn-with-caps function. Takes a validated parse result (from
 * shell-exec-parser.parseAndValidate), substitutes realpaths into argv
 * per round-2 LOW L1 (closes TOCTOU), spawns the binary with
 * shell:false + SAFE_ENV + ALLOWED_CWD + 30s timeout + 1 MiB output cap
 * (hand-rolled byte accumulator — Node spawn has no maxBuffer).
 *
 * Returns one of:
 *   - { ok: true, stdout, stderr, exit_code, duration_ms, argv }
 *   - { ok: false, error: 'timeout' | 'output_cap_exceeded' | 'spawn_failed',
 *       reason, exit_code: -1, partial_stdout?, partial_stderr?, duration_ms? }
 *
 * The tool body (shell-exec.js) wraps this and adds audit logging.
 */

import child_process from 'node:child_process';
import {
  SAFE_ENV,
  ALLOWED_CWD,
  SPAWN_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
  VERB_BINARY,
} from './shell-exec-verb-schemas.js';

function decodeOutput(buf) {
  try {
    return buf.toString('utf8');
  } catch {
    return `[binary content omitted: ${buf.length} bytes]`;
  }
}

/**
 * spawnWithCaps(validated) — validated is the ok-shape returned by
 * parseAndValidate (carries argv, schemaKey, verbTokens, resolvedPaths).
 */
export async function spawnWithCaps(validated) {
  const argv = validated.argv.slice();
  // Substitute realpaths into argv for path positionals (TOCTOU close).
  if (validated.resolvedPaths instanceof Map) {
    for (const [idx, realpath] of validated.resolvedPaths) {
      argv[idx] = realpath;
    }
  }
  const binary = VERB_BINARY[validated.argv[0]];
  if (!binary) {
    return {
      ok: false,
      error: 'spawn_failed',
      reason: 'no_binary_for_verb',
      exit_code: -1,
    };
  }

  const startedAt = Date.now();
  // Build SAFE_ENV — make a fresh object (don't pass the frozen one to
  // spawn so Node can't mutate; also so the spy can deep-equal).
  const env = { ...SAFE_ENV };

  return new Promise((resolve) => {
    let child;
    try {
      // Reference child_process.spawn at call time so node:test's
      // mock.method(child_process, 'spawn', …) can intercept. A
      // top-level `import { spawn }` would snapshot the binding and
      // dodge the spy.
      child = child_process.spawn(binary, argv.slice(1), {
        shell: false,
        cwd: ALLOWED_CWD,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        ok: false,
        error: 'spawn_failed',
        reason: err && err.code ? err.code : String(err),
        exit_code: -1,
        argv,
      });
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let totalBytes = 0;
    let capped = false;
    let spawnFailedReason = null;
    let resolved = false;
    const settle = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const onData = (chunks) => (chunk) => {
      if (capped) return;
      const len = chunk.length || (chunk.byteLength || 0);
      totalBytes += len;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        capped = true;
        try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
        return;
      }
      chunks.push(chunk);
    };

    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', onData(stdoutChunks));
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', onData(stderrChunks));
    }

    // spawn emits 'error' for ENOENT on argv[0], EACCES, or invalid cwd.
    // It may or may not emit 'exit' afterwards depending on the failure
    // mode. We settle on the first event of either, treating 'error'
    // before 'exit' as a structural spawn_failed.
    child.on('error', (err) => {
      spawnFailedReason = err && err.code ? err.code : String(err);
      const duration_ms = Date.now() - startedAt;
      settle({
        ok: false,
        error: 'spawn_failed',
        reason: spawnFailedReason,
        exit_code: -1,
        duration_ms,
        argv,
      });
    });

    child.on('exit', (code, signal) => {
      const duration_ms = Date.now() - startedAt;
      const partial_stdout = decodeOutput(Buffer.concat(stdoutChunks.map((b) => (Buffer.isBuffer(b) ? b : Buffer.from(b)))));
      const partial_stderr = decodeOutput(Buffer.concat(stderrChunks.map((b) => (Buffer.isBuffer(b) ? b : Buffer.from(b)))));

      if (capped) {
        settle({
          ok: false,
          error: 'output_cap_exceeded',
          reason: `process emitted >${MAX_OUTPUT_BYTES} bytes`,
          exit_code: -1,
          partial_stdout: partial_stdout.slice(0, 4000),
          partial_stderr: partial_stderr.slice(0, 4000),
          duration_ms,
          argv,
        });
        return;
      }
      if (spawnFailedReason) {
        settle({
          ok: false,
          error: 'spawn_failed',
          reason: spawnFailedReason,
          exit_code: -1,
          duration_ms,
          argv,
        });
        return;
      }
      if (signal === 'SIGKILL' && child.killed) {
        settle({
          ok: false,
          error: 'timeout',
          reason: `process exceeded ${SPAWN_TIMEOUT_MS} ms`,
          exit_code: -1,
          partial_stdout: partial_stdout.slice(0, 4000),
          partial_stderr: partial_stderr.slice(0, 4000),
          duration_ms,
          argv,
        });
        return;
      }
      settle({
        ok: true,
        stdout: partial_stdout.slice(0, 4000),
        stderr: partial_stderr.slice(0, 4000),
        exit_code: typeof code === 'number' ? code : 0,
        duration_ms,
        argv,
      });
    });
  });
}
