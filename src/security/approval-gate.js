/**
 * QuantumClaw Approval Gate
 *
 * Intercepts destructive tool calls and enforces approval workflow.
 * Integrates with ExecApprovals system.
 *
 * Decision order in check():
 *   0. autoApproveTools short-circuit
 *   1. Verb-scoped destructive-pattern match (shell tools only)
 *   2. Skill-dir allowlist bypass (shell tools with cwd targeting
 *      /root/QClaw/src/agents/skills/)
 *   3. Gated tool list
 *   4. Stripe charge special-case
 *
 * Verb-scoping (step 1) replaces the old JSON.stringify(args).includes()
 * keyword scan, which false-triggered on any sed script / file content
 * that happened to contain words like "truncate" or "delete". Now we
 * only inspect the first command token (or first two for patterns like
 * "pm2 stop"), never args bodies.
 *
 * Skill-dir allowlist (step 2) lets Charlie edit his own skill files
 * under /root/QClaw/src/agents/skills/ without Telegram approval. Scope
 * is tight: that exact directory, not /root/QClaw/** — source code edits
 * still require approval via the gatedTools rules.
 */

import path from 'path';
import { log } from '../core/logger.js';

const SKILL_EDIT_ALLOWLIST = '/root/QClaw/src/agents/skills/';

// Verbs (or two-token prefixes) that always require approval when they
// are the FIRST token of a shell command. Matched against the parsed
// verb only — never against full args body.
const DEFAULT_DESTRUCTIVE_PATTERNS = [
  'rm', 'kill', 'killall', 'shutdown', 'reboot', 'dd',
  'pm2 stop', 'pm2 delete', 'pm2 restart',
];

// Canonical shell tool is `shell_exec`; `ssh_exec` is retained as the slot for
// the future remote-exec path. `shell_execute` was a dormant alias (never
// registered) dropped in Slice 3c (2026-05-15).
const SHELL_TOOLS = ['shell_exec', 'ssh_exec'];

export class ApprovalGate {
  constructor(approvals, config = {}) {
    this.approvals = approvals;

    this.notifier = config.notifier || null;

    this.autoApproveTools = config.autoApproveTools || [];

    this.gatedTools = config.gatedTools || [
      'shell_exec',
    ];

    // Verb-scoped destructive patterns. Compare against the first shell
    // token (single-word patterns) or first two tokens (two-word patterns).
    this.destructivePatterns = config.destructivePatterns || DEFAULT_DESTRUCTIVE_PATTERNS;

    // Exact-prefix allowlist for skill edits. path.resolve() + startsWith()
    // ensures "/root/QClaw/src/agents/skills-evil/..." is NOT matched.
    this.skillEditAllowlist = config.skillEditAllowlist || SKILL_EDIT_ALLOWLIST;

    this.riskWeights = {
      shell_exec: 'high',
    };
  }

  /**
   * Parse the first one or two tokens of a shell command for verb matching.
   * Strips a leading `sudo ` if present so `sudo rm -rf` still reads as `rm`.
   * @param {string} command
   * @returns {{ first: string, firstTwo: string }}
   */
  _parseVerb(command) {
    if (typeof command !== 'string') return { first: '', firstTwo: '' };
    const stripped = command.trimStart().replace(/^sudo\s+/, '');
    const tokens = stripped.split(/\s+/).filter(Boolean);
    return {
      first: tokens[0] || '',
      firstTwo: tokens.slice(0, 2).join(' '),
    };
  }

  /**
   * Match shell tool calls against verb-scoped destructive patterns.
   * Single-word patterns (e.g. "rm") match the first token; two-word
   * patterns (e.g. "pm2 stop") match the first two tokens exactly.
   * Never inspects arbitrary args content.
   * @returns {string|null} the matching pattern, or null
   */
  _matchDestructivePattern(toolName, toolArgs) {
    if (!SHELL_TOOLS.includes(toolName)) return null;
    const command = toolArgs?.command;
    const { first, firstTwo } = this._parseVerb(command);
    if (!first) return null;
    for (const pattern of this.destructivePatterns) {
      if (pattern.includes(' ')) {
        if (firstTwo === pattern) return pattern;
      } else if (first === pattern) {
        return pattern;
      }
    }
    return null;
  }

  /**
   * True iff the operation targets the skill-edit allowlist directory.
   * Checks explicit structured fields (path, destination, cwd) only —
   * does NOT scan free-text command bodies. path.resolve() normalizes
   * relative paths and ".." segments before the startsWith check.
   */
  _isSkillDirOperation(toolName, toolArgs) {
    if (!toolArgs || typeof toolArgs !== 'object') return false;
    const candidates = [];
    if (typeof toolArgs.path === 'string') candidates.push(toolArgs.path);
    if (typeof toolArgs.destination === 'string') candidates.push(toolArgs.destination);
    if (typeof toolArgs.cwd === 'string') candidates.push(toolArgs.cwd);
    for (const p of candidates) {
      try {
        const resolved = path.resolve(p);
        if (resolved === this.skillEditAllowlist.replace(/\/$/, '') ||
            resolved.startsWith(this.skillEditAllowlist)) {
          return true;
        }
      } catch {
        // unresolvable path — ignore
      }
    }
    return false;
  }

  /**
   * Check if a tool call requires approval.
   * @returns {{ requiresApproval: boolean, reason?: string, riskLevel?: string }}
   */
  async check(toolName, toolArgs) {
    // 0. Auto-approved tools bypass all further checks
    if (this.autoApproveTools.includes(toolName)) {
      log.debug(`Auto-approved: ${toolName}`);
      return { requiresApproval: false };
    }

    // 1. Destructive verb match (shell tools only) — always gates, even
    // when the target is inside the skill-edit allowlist. `rm` on a
    // skill file still requires approval.
    const destructiveHit = this._matchDestructivePattern(toolName, toolArgs);
    if (destructiveHit) {
      return {
        requiresApproval: true,
        reason: `Destructive command verb: "${destructiveHit}"`,
        riskLevel: 'high',
      };
    }

    // 2. Skill-dir allowlist — non-destructive ops targeting
    // /root/QClaw/src/agents/skills/** bypass the remaining checks.
    if (this._isSkillDirOperation(toolName, toolArgs)) {
      log.info(`Skill-dir operation bypassed approval gate: ${toolName}`);
      return { requiresApproval: false };
    }

    // 3. Gated tool list
    if (this.gatedTools.includes(toolName)) {
      const riskLevel = this.riskWeights[toolName] || 'medium';
      return {
        requiresApproval: true,
        reason: `${toolName} requires approval (gated tool)`,
        riskLevel,
      };
    }

    // 4. Stripe charge — verb-scoped against explicit action field,
    // not JSON.stringify scan.
    if (toolName.includes('stripe')) {
      const action = toolArgs?.action || toolArgs?.operation || toolArgs?.type;
      if (action === 'charge' || toolName.includes('charge')) {
        return {
          requiresApproval: true,
          reason: 'Stripe payment action detected',
          riskLevel: 'critical',
        };
      }
    }

    return { requiresApproval: false };
  }

  async requestApproval(agent, toolName, toolArgs, riskLevel) {
    const action = `${toolName}(${JSON.stringify(toolArgs).slice(0, 200)})`;
    const detail = `Agent ${agent} wants to execute: ${action}`;

    log.warn(`⏸️  Approval required: ${action}`);

    // Delegate to requestInlineApproval so the notifier always fires —
    // there should be one approval-creation code path, not two.
    // Pre-fix: this path called approvals.request() directly and bypassed
    // the notifier, so executor-driven approvals (the path used by
    // tier-classified tool calls in agent.process()) timed out silently
    // with no Telegram prompt ever sent.
    return this.requestInlineApproval({
      agent,
      tool: toolName,
      action,
      detail,
      riskLevel,
    });
  }

  /**
   * Request inline approval — creates a pending approval record, fires the
   * Telegram notifier if configured, and awaits the human decision (or 10-min
   * auto-deny). Used by shell_exec and n8n_workflow_update.
   */
  async requestInlineApproval({ agent, tool, action, detail, riskLevel = 'medium' }) {
    if (!this.approvals?.createPending) {
      log.warn('requestInlineApproval: approvals subsystem unavailable — auto-deny');
      return { approved: false, id: -1, reason: 'approvals unavailable' };
    }

    const { id, promise } = await this.approvals.createPending(agent, tool, detail || action, riskLevel);

    if (this.notifier) {
      try {
        await this.notifier({ id, agent, tool, action, detail, riskLevel });
      } catch (err) {
        log.debug(`approval notifier failed (id=${id}): ${err.message}`);
      }
    } else {
      log.warn(`No notifier wired — approval [${id}] will only be visible via dashboard/CLI`);
    }

    return promise;
  }

  setNotifier(fn) {
    this.notifier = fn;
  }

  gateToolRuntime(toolName, riskLevel = 'medium') {
    if (!this.gatedTools.includes(toolName)) {
      this.gatedTools.push(toolName);
      this.riskWeights[toolName] = riskLevel;
      log.info(`Gated tool added: ${toolName} (${riskLevel})`);
    }
  }

  ungateToolRuntime(toolName) {
    const index = this.gatedTools.indexOf(toolName);
    if (index > -1) {
      this.gatedTools.splice(index, 1);
      log.info(`Tool ungated: ${toolName}`);
    }
  }
}
