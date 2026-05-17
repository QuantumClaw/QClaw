/**
 * QuantumClaw — shell_exec tool (Slice 3d structural redesign)
 *
 * shell_exec accepts a small structurally-validated surface of read-only
 * verbs:
 *   - `ls`            (paths under /root/QClaw; per-arg PathSchema)
 *   - `cat`           (paths under /root/QClaw; per-arg PathSchema)
 *   - `git status`    (no positional args)
 *   - `git log`       (no positional args; -n/--max-count int-bounded,
 *                      --oneline/--all/--graph bool)
 *   - `pm2 list`      (alias `pm2 ls`)
 *
 * Defence layers (all structural — no regex-on-shell-string):
 *
 *   1. **Parse-time** (shell-exec-parser.js §1) — hand-rolled state-
 *      machine tokenizer rejects every shell metacharacter at parse
 *      time. No bash ever sees the input.
 *   2. **Schema** (shell-exec-verb-schemas.js §2) — per-verb flag
 *      whitelist (no enumeration via blocklist), IntSchema-bounded
 *      value flags, combined-short-flag rejection.
 *   3. **Path resolution** (shell-exec-verb-schemas.js §4) —
 *      path.resolve() + fs.realpathSync() + DENY-on-real + ALLOW-on-real.
 *      Closes symlink-follow and `..`-traversal classes.
 *   4. **Spawn** (shell-exec-spawn.js §4) — child_process.spawn with
 *      shell:false, absolute-path argv[0], SAFE_ENV (GIT_CONFIG_GLOBAL=
 *      /dev/null + GIT_CONFIG_NOSYSTEM=1 to neutralise user-level git
 *      aliases), hardcoded cwd /root/QClaw, 30s timeout, 1 MiB output
 *      cap with hand-rolled byte accumulator, realpath substitution
 *      into argv (TOCTOU close).
 *
 * Every call is audit-logged with the parsed argv, schema key, and
 * rejection stage (parse | schema | path | spawn | null on success).
 *
 * Design SSOT: /tmp/slice3d_design.md (v4 — 4 rounds of adversarial
 * review). Replaces Slice 3c's regex-on-shell-string DENY_PATTERNS /
 * DESTRUCTIVE_PATTERNS / QUANTUMCLAW_DIR_RE stack (deleted from this
 * file in Unit 2). The Slice 3c.1 soft-deny stub
 * (`createDisabledShellExecTool`) is retained as the kill-switch
 * (`QCLAW_SHELL_EXEC_ENABLED=0` re-enables it for rollback).
 */

import { log } from '../core/logger.js';
import { parseAndValidate, suggestFor } from './shell-exec-parser.js';
import { spawnWithCaps } from './shell-exec-spawn.js';

/**
 * Disabled stub for shell_exec — kill-switch for emergency rollback.
 *
 * Set `QCLAW_SHELL_EXEC_ENABLED=0` (or `false`/`no`/`off`) to register
 * this stub instead of the real tool. The stub returns a structured
 * soft-deny without spawning anything. The approval gate's shell_exec
 * early-bypass returns `requiresApproval:false` so the stub is reached
 * without a Telegram prompt.
 *
 * Default (Slice 3d): enabled. Pre-3d default was disabled.
 */
export function createDisabledShellExecTool({ audit, auditActor = 'charlie' } = {}) {
  return {
    description: 'shell_exec is DISABLED via QCLAW_SHELL_EXEC_ENABLED kill-switch. Calls return a structured soft-deny (error=shell_exec_disabled). Re-enable by unsetting QCLAW_SHELL_EXEC_ENABLED (Slice 3d default = enabled). For shell operations while disabled, use claude_code_dispatch (Slice 5) or escalate to Tyson.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command (rejected — tool is disabled).' },
      },
      required: ['command'],
    },
    longRunning: false,
    fn: async (args) => {
      const command = String(args?.command ?? '').slice(0, 200);
      log.warn(`shell_exec DISABLED (kill-switch active): ${command.slice(0, 120)}`);
      audit?.log?.(auditActor, 'shell_exec_disabled', command, {
        flag: 'QCLAW_SHELL_EXEC_ENABLED',
        value: process.env.QCLAW_SHELL_EXEC_ENABLED ?? '(unset)',
      });
      return {
        ok: false,
        error: 'shell_exec_disabled',
        reason: 'shell_exec is disabled by the QCLAW_SHELL_EXEC_ENABLED kill-switch. Unset the env var to restore the Slice 3d enabled-with-5-verbs behaviour.',
        command,
        exit_code: -1,
      };
    },
  };
}

/**
 * Returns true when `shell_exec` is enabled for this process.
 *
 * Slice 3d flips the default from disabled to ENABLED. The
 * `QCLAW_SHELL_EXEC_ENABLED` env var is now consulted only for its
 * DISABLE values — explicit `0`/`false`/`no`/`off` (case-insensitive)
 * registers the disabled stub. Any other value (including unset)
 * registers the real Slice 3d tool.
 */
export function isShellExecEnabled() {
  const raw = process.env.QCLAW_SHELL_EXEC_ENABLED;
  if (raw === undefined || raw === null) return true;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return true;
}

/**
 * Build the Slice 3d shell_exec tool. The tool fn:
 *   1. Trims / empty-check the command string.
 *   2. Calls parseAndValidate (parser + schema + path-resolution).
 *      Rejection → structured error (single source of truth for shape).
 *   3. On success, calls spawnWithCaps (substitutes realpaths into argv
 *      for TOCTOU close, spawns with shell:false + SAFE_ENV + caps).
 *   4. Audit-logs the call with parsed_argv, schema_key, rejection_stage.
 *
 * No approval-required path — the structural validation IS the
 * authorisation (none of the 5 verbs is destructive). The legacy
 * `approvalGate.requestInlineApproval` plumbing is removed.
 *
 * `parserOptions` is a TEST-ONLY pass-through to parseAndValidate. The
 * production caller (src/index.js) never passes it; the frozen
 * production constants are used. Test code (e.g. tests/approval-gate-
 * shell-exec-parser.test.js) injects fixture-based overrides through
 * this surface so end-to-end gate+tool tests can run on CI runners
 * with no /root access. See src/tools/shell-exec-parser.js for the
 * options-object contract and tests/_shell-exec-fixtures.js for the
 * helper that builds it.
 */
export function createShellExecTool({ audit, auditActor = 'charlie', parserOptions } = {}) {
  return {
    description: 'Execute one of five structurally-validated read-only shell verbs on the qclaw server: `ls`, `cat`, `git status`, `git log`, `pm2 list` (alias `pm2 ls`). Paths must be absolute and resolve under /root/QClaw (DENY entries override; symlinks resolved through realpath, no symlink-leak). Combined short flags are rejected — use `ls -l -a`, NOT `ls -la`. The -n flag on `git log` is a value-flag: use `git log -n 20 --oneline`, NOT `git log -n --oneline` (the parser would consume `--oneline` as the int value). 30s timeout, 1 MiB combined-output cap, ASCII-only, 8 KiB input cap. Shell metacharacters (newlines, ;, |, &, <, >, $, `, ~, *, ?, [, ], {, }, #) are rejected at parse time — no bash ever sees the input. inputSchema accepts only {command: string} — `cwd` and `timeout_ms` are NOT accepted (hardcoded). For everything else (awk, sed, sort, find, head, tail, grep, write ops, log inspection) use claude_code_dispatch.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute. ASCII-only, ≤8 KiB. See tool description for the 5 verbs.' },
      },
      required: ['command'],
    },
    longRunning: false,
    fn: async (args) => {
      const command = String(args?.command ?? '').trim();
      if (!command) {
        return {
          ok: false,
          error: 'empty_command',
          reason: 'missing or empty command',
          exit_code: -1,
        };
      }

      const validated = parseAndValidate(command, parserOptions);
      if (!validated.ok) {
        const rejectionStage =
          validated.error === 'parse_error' || validated.error === 'rejected_feature'
            ? 'parse'
            : validated.error === 'path_denied' || validated.error === 'not_in_allow_prefix'
            ? 'path'
            : 'schema';
        log.warn(`shell_exec REJECTED [${validated.error}/${validated.reason}] (${rejectionStage}): ${command.slice(0, 160)}`);
        audit?.log?.(auditActor, 'shell_exec_rejected', command.slice(0, 200), {
          error: validated.error,
          reason: validated.reason,
          detail: validated.detail,
          rejection_stage: rejectionStage,
        });
        return {
          ok: false,
          error: validated.error,
          reason: validated.reason,
          detail: validated.detail,
          command: command.slice(0, 200),
          suggestion: suggestFor(validated),
          exit_code: -1,
        };
      }

      const result = await spawnWithCaps(validated);
      const truncatedArgv = Array.isArray(result.argv) ? result.argv.slice(0, 8) : null;
      const rejectionStage = result.ok ? null : 'spawn';
      audit?.log?.(auditActor, result.ok ? 'shell_exec' : 'shell_exec_spawn_failed', command.slice(0, 200), {
        exit_code: result.exit_code,
        duration_ms: result.duration_ms,
        parsed_argv: truncatedArgv,
        schema_key: validated.schemaKey,
        rejection_stage: rejectionStage,
        error: result.error,
        reason: result.reason,
        stdout_bytes: result.stdout ? result.stdout.length : 0,
        stderr_bytes: result.stderr ? result.stderr.length : 0,
      });
      return result;
    },
  };
}
