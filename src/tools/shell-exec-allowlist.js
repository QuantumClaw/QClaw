/**
 * QuantumClaw — read-only shell command allowlist (Slice 3c)
 *
 * Primary-line defence for `shell_exec`. The check runs before the
 * existing DENY / DESTRUCTIVE / quantumclaw-dir gates in `shell-exec.js`.
 *
 * Semantics:
 *   1. Strip a leading `sudo ` (the existing DESTRUCTIVE gate already
 *      flags `sudo` for approval; the allowlist still applies underneath).
 *   2. Reject any command containing `;`, `&&`, `||`, standalone `&`,
 *      `$(`, or backticks — these enable chaining / command substitution
 *      that would let a non-allowlisted verb run behind an allowlisted
 *      one. (Pipes `|` are permitted so `grep … | head -n` works.)
 *   3. Split on `|` into pipeline segments. Every segment's first verb
 *      (or first-two-word verb for `git X`, `pm2 X`) must be in the
 *      allowlist.
 *   4. Per-verb disallowed flags (`find -delete`, `sed -i`) reject the
 *      command outright.
 *   5. Per-verb required flags (`pm2 logs` needs `--nostream`) reject if
 *      missing.
 *
 * If the check fails, `shell-exec.js` returns a structured
 * `{ error: 'not_allowlisted', reason, command, suggestion }` and the
 * existing approval system is never consulted. Allowlisted commands
 * pass through to DENY / DESTRUCTIVE / quantumclaw-dir as before —
 * defence in depth.
 */

const SINGLE_VERBS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc',
  'sort', 'uniq',
  'grep', 'find',
  'awk', 'sed',
]);

const TWO_WORD_VERBS = new Set([
  'git status',
  'git log',
  'git diff',
  'pm2 list',
  'pm2 logs',
]);

const DISALLOWED_FLAGS = {
  find: ['-delete', '-exec', '-execdir', '-fprint', '-fprintf', '-ok'],
  sed: ['-i', '--in-place'],
};

const REQUIRED_FLAGS = {
  'pm2 logs': ['--nostream'],
};

const CHAIN_REJECT_PATTERNS = [
  { name: 'semicolon chain', re: /;/ },
  { name: 'logical and', re: /&&/ },
  { name: 'logical or', re: /\|\|/ },
  { name: 'background', re: /(^|[^&])&(?!&)/ },
  { name: 'command substitution $()', re: /\$\(/ },
  { name: 'command substitution backtick', re: /`/ },
  // bash treats \n / \r exactly like ';' — without this, an attacker
  // who can land an embedded newline in `command` ships a second
  // statement past every allowlist check (Slice 3c.1 adversarial-review
  // finding 2026-05-15: `pm2 list\necho pwned` executed both lines as
  // root with no approval prompt under the post-3c.1 gate ordering).
  { name: 'newline', re: /[\r\n]/ },
];

export function listAllowedVerbs() {
  return [...SINGLE_VERBS, ...TWO_WORD_VERBS].sort();
}

function rejectionSuggestion(reason, detail = {}) {
  const allowed = listAllowedVerbs().join(', ');
  if (reason === 'not_allowlisted') {
    return `verb '${detail.verb || ''}' is not on the read-only allowlist. allowed: ${allowed}. for write operations use claude_code_dispatch or escalate to Tyson.`;
  }
  if (reason === 'disallowed_flag') {
    return `'${detail.verb} ${detail.flag}' mutates state. read-only forms of ${detail.verb} are allowed; use claude_code_dispatch or escalate to Tyson for writes.`;
  }
  if (reason === 'missing_required_flag') {
    return `'${detail.verb}' requires ${detail.flag} (streaming-mode logs would block the agent indefinitely).`;
  }
  if (reason === 'chain_or_substitution') {
    return `command chaining / substitution (${detail.pattern}) is not permitted. run sub-commands as separate shell_exec calls. pipes (|) are allowed.`;
  }
  return `command rejected by allowlist (${reason}).`;
}

function splitPipeline(command) {
  const segments = [];
  let buf = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    if (c === '|' && !inSingle && !inDouble && command[i - 1] !== '|' && command[i + 1] !== '|') {
      segments.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) segments.push(buf.trim());
  return segments;
}

function checkSegment(segment) {
  const tokens = segment.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { allowed: false, reason: 'empty_segment' };
  const first = tokens[0];
  const firstTwo = tokens.slice(0, 2).join(' ');

  const key = TWO_WORD_VERBS.has(firstTwo) ? firstTwo
    : SINGLE_VERBS.has(first) ? first
      : null;

  if (!key) {
    return {
      allowed: false,
      reason: 'not_allowlisted',
      verb: first,
      segment,
    };
  }

  const disallowed = DISALLOWED_FLAGS[key] || [];
  for (const flag of disallowed) {
    if (tokens.includes(flag)) {
      return { allowed: false, reason: 'disallowed_flag', verb: key, flag, segment };
    }
  }

  const required = REQUIRED_FLAGS[key] || [];
  for (const flag of required) {
    if (!tokens.includes(flag)) {
      return { allowed: false, reason: 'missing_required_flag', verb: key, flag, segment };
    }
  }

  return { allowed: true, verb: key };
}

export function checkAllowlist(rawCommand) {
  const command = String(rawCommand || '').trim();
  if (!command) {
    return { allowed: false, reason: 'empty', suggestion: 'no command provided' };
  }

  const stripped = command.replace(/^sudo\s+/, '');

  for (const { name, re } of CHAIN_REJECT_PATTERNS) {
    if (re.test(stripped)) {
      return {
        allowed: false,
        reason: 'chain_or_substitution',
        pattern: name,
        suggestion: rejectionSuggestion('chain_or_substitution', { pattern: name }),
      };
    }
  }

  const segments = splitPipeline(stripped);
  for (const segment of segments) {
    const result = checkSegment(segment);
    if (!result.allowed) {
      return {
        ...result,
        suggestion: rejectionSuggestion(result.reason, result),
      };
    }
  }

  return { allowed: true, segments: segments.length };
}

export const ALLOWLIST_SPEC = {
  singleVerbs: [...SINGLE_VERBS],
  twoWordVerbs: [...TWO_WORD_VERBS],
  disallowedFlags: { ...DISALLOWED_FLAGS },
  requiredFlags: { ...REQUIRED_FLAGS },
  chainRejectPatterns: CHAIN_REJECT_PATTERNS.map(p => p.name),
};
