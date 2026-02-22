/**
 * QuantumClaw Trust Kernel
 *
 * VALUES.md is the agent's constitution. Immutable at runtime.
 * Only the human owner can edit this file.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { log } from '../core/logger.js';

const DEFAULT_VALUES = `# Trust Kernel — VALUES.md

These rules are immutable at runtime. The agent cannot modify them.
Only you (the owner) can edit this file.

## Hard Rules

- Never send money without explicit owner approval
- Never delete data without explicit owner approval
- Never share API keys, passwords, or secrets with anyone
- Never impersonate the owner in legally binding communications
- Never access systems beyond what skills explicitly permit
- Always log destructive actions to the audit trail
- Always ask before contacting a new external service

## Soft Rules (agent can adapt these via Evolution Loop)

- Be direct and concise
- Use British English
- No sycophantic openers ("Great question!" etc.)
- Prioritise the owner's time over everything

## Approved Contacts

The agent may proactively contact:
- (add names/channels as needed)

## Forbidden Actions

The agent must never:
- (add specific actions to block)
`;

export class TrustKernel {
  constructor(config) {
    this.file = join(config._dir, 'VALUES.md');
    this.rules = { hard: [], soft: [], forbidden: [] };
    this.raw = '';
  }

  async load() {
    if (!existsSync(this.file)) {
      writeFileSync(this.file, DEFAULT_VALUES);
      log.info('Trust Kernel (VALUES.md) created');
    }

    this.raw = readFileSync(this.file, 'utf-8');
    this._parse();
  }

  /**
   * Check if an action is allowed by the Trust Kernel.
   * Returns { allowed: boolean, reason: string }
   */
  check(action) {
    // Check hard rules
    for (const rule of this.rules.hard) {
      if (this._violates(action, rule)) {
        return {
          allowed: false,
          reason: `Blocked by Trust Kernel: ${rule}`
        };
      }
    }

    // Check forbidden actions
    for (const rule of this.rules.forbidden) {
      if (this._violates(action, rule)) {
        return {
          allowed: false,
          reason: `Forbidden action: ${rule}`
        };
      }
    }

    return { allowed: true, reason: null };
  }

  /**
   * Get soft rules for the agent's personality/behaviour
   */
  getSoftRules() {
    return this.rules.soft;
  }

  /**
   * Get the full VALUES.md content for the agent's context
   */
  getContext() {
    return this.raw;
  }

  _parse() {
    let section = null;

    for (const line of this.raw.split('\n')) {
      const trimmed = line.trim();

      if (trimmed.startsWith('## Hard Rules')) section = 'hard';
      else if (trimmed.startsWith('## Soft Rules')) section = 'soft';
      else if (trimmed.startsWith('## Forbidden')) section = 'forbidden';
      else if (trimmed.startsWith('## ')) section = null;

      if (section && trimmed.startsWith('- ') && !trimmed.includes('(add ')) {
        this.rules[section].push(trimmed.slice(2));
      }
    }
  }

  _violates(action, rule) {
    const ruleLower = rule.toLowerCase();
    const actionLower = (action.type + ' ' + (action.description || '')).toLowerCase();

    // Simple keyword matching for v1
    // TODO: Use LLM-based rule checking for nuanced cases
    const keywords = ['delete', 'send money', 'share', 'impersonate', 'secret', 'password', 'api key'];
    for (const kw of keywords) {
      if (ruleLower.includes(kw) && actionLower.includes(kw)) {
        return true;
      }
    }
    return false;
  }
}
