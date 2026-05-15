/**
 * QuantumClaw — shell_exec tool
 *
 * Executes a shell command on the qclaw server as the quantumclaw user
 * (currently root — quantumclaw PM2 runs under root). Four safety tiers:
 *
 *   0. Allowlist (Slice 3c) — primary defence. First verb (or first-two-word
 *      verb for `git X`, `pm2 X`) must be on the read-only allowlist in
 *      `shell-exec-allowlist.js`. Chaining / command substitution rejected
 *      at the same layer; pipes permitted with every segment allowlisted.
 *      Non-allowlisted commands return `{error:'not_allowlisted',...}` and
 *      never reach approval.
 *
 *   1. DENY_PATTERNS — hard-block. Never executed, never routed to approval.
 *      Covers secret exfiltration and pipe-to-shell RCE patterns. Still
 *      catches allowlisted verbs aimed at forbidden paths (e.g.
 *      `cat /root/.quantumclaw/.env`).
 *
 *   2. DESTRUCTIVE_PATTERNS — require inline Telegram approval.
 *      Covers anything that deletes/kills/force-pushes/redirects-to-root.
 *
 *   3. /root/.quantumclaw touches — require approval (even read-only).
 *      Surfaces when Charlie is poking around secrets/config.
 *
 * Every call is audit-logged with truncated stdout/stderr (500 chars each).
 * Default 60s timeout, max 300s.
 *
 * Threat model note: shell_exec makes Charlie's LLM a root-code-execution
 * endpoint. Slice 3c's allowlist closes the "novel safe-looking command"
 * gap by inverting the gate from blocklist to allowlist — only read-only
 * verbs pass. DENY remains as a second-line catch for forbidden-path
 * touches by allowlisted verbs. See QCLAW_BUILD_LOG.md Slice 3c entry.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from '../core/logger.js';
import { checkAllowlist } from './shell-exec-allowlist.js';

const execAsync = promisify(exec);

const DEFAULT_TIMEOUT_MS = 60 * 1000;
const MAX_TIMEOUT_MS = 300 * 1000;
const DEFAULT_CWD = '/root/QClaw';

// Hard-block. Matched first. No approval path.
const DENY_PATTERNS = [
  { name: 'cat .env', re: /\bcat\s+.*\/\.env\b/ },
  { name: 'cat .secrets', re: /\bcat\s+.*\.secrets(\.enc)?\b/ },
  { name: 'quantumclaw secrets file', re: /\/root\/\.quantumclaw\/\.(env|secrets)/ },
  { name: '.ssh access', re: /\/root\/\.ssh\// },
  { name: 'pipe-to-shell', re: /(curl|wget)\s+.+\|\s*(sh|bash|zsh)/ },
  { name: 'base64 exfil', re: /\bbase64\b.*\/root\/\.quantumclaw/ },
  { name: 'source .env', re: /\bsource\s+.*\.env\b/ },
  { name: 'eval', re: /\beval\b/ },
  { name: 'echo .env', re: /\becho\s+.*\/\.env/ },
];

// Matched after DENY. Require Telegram approval before running.
// Note: pm2 restart and pm2 reload are recovery ops and NOT gated.
const DESTRUCTIVE_PATTERNS = [
  { name: 'rm -rf / -r', re: /\brm\s+-[rf]+\b/ },
  { name: 'sudo', re: /\bsudo\b/ },
  { name: 'kill/killall', re: /\bkill(all)?\s/ },
  { name: 'pm2 stop/delete/kill', re: /\bpm2\s+(stop|delete|kill)/ },
  { name: 'systemctl stop/disable/mask', re: /\bsystemctl\s+(stop|disable|mask)/ },
  { name: 'chmod on absolute path', re: /\bchmod\s+[0-7]{3,4}\s+\// },
  { name: 'chown', re: /\bchown\b/ },
  { name: 'git force push', re: /\bgit\s+push\s+.*--force/ },
  { name: 'git reset --hard', re: /\bgit\s+reset\s+--hard/ },
  { name: 'docker compose down', re: /\bdocker\s+compose\s+down/ },
  { name: 'docker rm/rmi/kill', re: /\bdocker\s+(rm|rmi|kill)/ },
  { name: 'dd if=', re: /\bdd\s+if=/ },
  { name: 'redirect outside /tmp', re: /\s>\s*\/(?!dev\/null|tmp\/)/ },
  { name: 'append redirect outside /tmp', re: />>\s*\/(?!dev\/null|tmp\/)/ },
  { name: 'relative-path redirect', re: />\s*(?!\/dev\/null|\/tmp\/)[^\/\s>]/ },
  { name: 'tee outside /tmp', re: /\btee\s+(-a\s+)?\/(?!dev\/null|tmp\/)/ },
];

// Any reference to the qclaw config directory → approval (even for reads).
// DENY patterns run first so .env / .secrets hits are blocked before this.
const QUANTUMCLAW_DIR_RE = /\/root\/\.quantumclaw\b/;

export function createShellExecTool({ approvalGate, audit, auditActor = 'charlie' }) {
  return {
    description: 'Execute a read-only shell command on the qclaw server. Allowlisted verbs only: ls, cat, head, tail, wc, sort, uniq, grep, find, awk, sed, git status, git log, git diff, pm2 list, pm2 logs --nostream. Pipes (|) permitted; chaining (;, &&, ||) and command substitution ($(...), backticks) rejected. find -delete / -exec, sed -i, and pm2 logs without --nostream rejected. Non-allowlisted commands return {error:"not_allowlisted",suggestion:...}; allowlisted commands still pass through DENY (secret paths) and DESTRUCTIVE (redirects, sudo) gates. For write operations use claude_code_dispatch (Slice 5) or escalate to Tyson. Default 60s timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute.' },
        timeout_ms: { type: 'integer', description: 'Timeout in ms (default 60000, max 300000).' },
        cwd: { type: 'string', description: 'Working directory (default /root/QClaw).' },
      },
      required: ['command'],
    },
    longRunning: true, // may wait on Telegram approval — executor uses 11-min ceiling
    fn: async (args) => {
      const command = String(args?.command ?? '').trim();
      const timeout = Math.min(
        Math.max(parseInt(args?.timeout_ms ?? DEFAULT_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS, 1000),
        MAX_TIMEOUT_MS
      );
      const cwd = args?.cwd || DEFAULT_CWD;
      const startedAt = Date.now();

      if (!command) return { error: 'Missing command', exit_code: -1 };

      // 0. Allowlist (Slice 3c) — first-line defence. Non-allowlisted
      //    verbs, chaining, and command substitution are rejected here
      //    BEFORE the approval system is consulted.
      const allowlistCheck = checkAllowlist(command);
      if (!allowlistCheck.allowed) {
        log.warn(`shell_exec NOT ALLOWLISTED [${allowlistCheck.reason}]: ${command.slice(0, 160)}`);
        audit?.log?.(auditActor, 'shell_exec_not_allowlisted', command.slice(0, 200), {
          reason: allowlistCheck.reason,
          verb: allowlistCheck.verb,
          flag: allowlistCheck.flag,
          pattern: allowlistCheck.pattern,
        });
        return {
          error: 'not_allowlisted',
          reason: allowlistCheck.reason,
          verb: allowlistCheck.verb,
          flag: allowlistCheck.flag,
          command: command.slice(0, 200),
          suggestion: allowlistCheck.suggestion,
          exit_code: -1,
        };
      }

      // 1. DENY — hard block
      for (const { name, re } of DENY_PATTERNS) {
        if (re.test(command)) {
          log.warn(`shell_exec DENIED by policy [${name}]: ${command.slice(0, 160)}`);
          audit?.log?.(auditActor, 'shell_exec_denied_by_policy', command.slice(0, 200), {
            pattern_matched: name,
          });
          return {
            error: 'Command denied by policy',
            pattern_matched: name,
            command: command.slice(0, 200),
            exit_code: -1,
          };
        }
      }

      // 2. Decide whether approval is needed
      const destructiveHit = DESTRUCTIVE_PATTERNS.find(p => p.re.test(command));
      const qclawDirHit = QUANTUMCLAW_DIR_RE.test(command);
      const needsApproval = destructiveHit || qclawDirHit;
      let approvedInline = false;

      if (needsApproval) {
        const reason = destructiveHit
          ? `Destructive pattern [${destructiveHit.name}]`
          : 'Touches /root/.quantumclaw';
        const decision = await approvalGate.requestInlineApproval({
          agent: auditActor,
          tool: 'shell_exec',
          action: `${reason}: ${command.slice(0, 120)}`,
          detail: command.slice(0, 800),
          riskLevel: destructiveHit ? 'high' : 'medium',
        });
        if (!decision?.approved) {
          audit?.log?.(auditActor, 'shell_exec_denied_approval', command.slice(0, 200), {
            approval_id: decision?.id,
            reason: decision?.reason || 'denied',
          });
          return {
            error: 'Approval denied',
            approval_id: decision?.id,
            reason: decision?.reason || 'denied',
            command: command.slice(0, 200),
            exit_code: -1,
          };
        }
        approvedInline = true;
      }

      // 3. Execute
      let stdout = '';
      let stderr = '';
      let exitCode = 0;
      try {
        const res = await execAsync(command, {
          cwd,
          timeout,
          maxBuffer: 10 * 1024 * 1024,
          shell: '/bin/bash',
          killSignal: 'SIGKILL',
        });
        stdout = res.stdout || '';
        stderr = res.stderr || '';
      } catch (err) {
        stdout = err.stdout || '';
        stderr = err.stderr || err.message || '';
        exitCode = typeof err.code === 'number' ? err.code : 1;
      }

      const duration_ms = Date.now() - startedAt;

      audit?.log?.(auditActor, 'shell_exec', command.slice(0, 200), {
        exit_code: exitCode,
        duration_ms,
        approved_inline: approvedInline,
        cwd,
        stdout: String(stdout).slice(0, 500),
        stderr: String(stderr).slice(0, 500),
      });

      return {
        stdout: String(stdout).slice(0, 4000),
        stderr: String(stderr).slice(0, 4000),
        exit_code: exitCode,
        duration_ms,
        approved_inline: approvedInline,
      };
    },
  };
}
