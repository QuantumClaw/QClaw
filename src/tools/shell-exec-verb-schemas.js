/**
 * QuantumClaw — shell_exec verb schemas, path-resolution, env (Slice 3d)
 *
 * Per design SSOT (/tmp/slice3d_design.md v4). The 5 v1 verbs are
 * `ls`, `cat`, `git status`, `git log`, `pm2 list` (with `pm2 ls` alias).
 *
 * Exports:
 *   - VERB_SCHEMAS — per-verb spec (flags, positional, max argv).
 *   - VERB_BINARY  — absolute path of each verb binary.
 *   - SAFE_ENV     — hardcoded environment for spawn().
 *   - ALLOWED_CWD  — single fixed cwd.
 *   - SPAWN_TIMEOUT_MS, MAX_OUTPUT_BYTES — execution caps.
 *   - DENY_PREFIXES, DENY_GLOBS, matchesDeny, globMatch — path DENY.
 *   - DANGEROUS_GIT_CONFIG_LEAVES, DANGEROUS_GIT_CONFIG_SECTIONS — the
 *     repo-local-git-config trust-boundary regression-test surface.
 *   - resolvePath — path.resolve + fs.realpathSync + DENY+ALLOW chain.
 */

import path from 'node:path';
import fs from 'node:fs';

// ---------- Constants ----------

export const ALLOWED_CWD = '/root/QClaw';
export const SPAWN_TIMEOUT_MS = 30_000;            // 30 s, hard cap
export const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;   // 1 MiB combined

export const SAFE_ENV = Object.freeze({
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  HOME: '/root',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  GIT_PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  PM2_HOME: '/root/.pm2',
});

// Verb name → absolute binary path. PATH lookup is neutralised — spawn
// receives an absolute path.
export const VERB_BINARY = Object.freeze({
  ls: '/bin/ls',
  cat: '/bin/cat',
  git: '/usr/bin/git',
  pm2: '/usr/bin/pm2',
});

// ---------- DENY data ----------

// Literal prefix strings. Match if candidate === prefix OR
// candidate.startsWith(prefix + '/').
export const DENY_PREFIXES = Object.freeze([
  '/proc',
  '/root/.ssh',
  '/root/.aws',
  '/root/.config/gh',
  '/root/.gnupg',
  '/root/.docker',
  '/root/.npmrc',
  '/root/.bash_history',
  '/root/.gitconfig',
  '/root/.quantumclaw/.env',
  '/root/.quantumclaw/.secrets',
  '/root/.quantumclaw/.secrets.enc',
  '/root/.quantumclaw/config.json',
  '/etc/shadow',
  '/etc/gshadow',
  '/etc/sudoers',
  '/etc/sudoers.d',
  '/etc/ssh',
  '/root/QClaw/.git/config',
  '/root/QClaw/.env',
  '/root/QClaw/credentials.json',
  '/root/QClaw/secrets',
]);

// Glob patterns. Match via globMatch().
export const DENY_GLOBS = Object.freeze([
  '/root/**/.env',
  '/root/**/.env.*',
  '/root/QClaw/**/credentials*.json',
  '/root/QClaw/data/*.sql',
  '/root/QClaw/node_modules/**/.env',
]);

// ---------- globMatch (hand-rolled, semantics pinned by tests) ----------

/**
 * globMatch(absPath, pattern) — boolean.
 *
 * Semantics (pinned to tests/shell-exec-path-resolve.test.js):
 *   - `**`     matches zero or more path segments
 *   - `*`      matches zero or more characters within a single segment
 *   - `?`      matches exactly one character within a single segment
 *   - `[abc]`  matches one char from the class
 *   - No `{a,b}` alternation, no extglob, no leading-! negation.
 */
export function globMatch(absPath, pattern) {
  const pSegs = pattern.split('/');
  const aSegs = absPath.split('/');
  return matchSegs(pSegs, 0, aSegs, 0);
}

function matchSegs(pSegs, pi, aSegs, ai) {
  while (pi < pSegs.length) {
    const p = pSegs[pi];
    if (p === '**') {
      // Zero-or-more path segments. Try every possible consumption.
      // Optimisation: collapse runs of consecutive '**'.
      let nextP = pi + 1;
      while (nextP < pSegs.length && pSegs[nextP] === '**') nextP += 1;
      if (nextP === pSegs.length) return true; // trailing ** swallows rest
      for (let k = ai; k <= aSegs.length; k++) {
        if (matchSegs(pSegs, nextP, aSegs, k)) return true;
      }
      return false;
    }
    if (ai >= aSegs.length) return false;
    if (!segMatch(p, aSegs[ai])) return false;
    pi += 1;
    ai += 1;
  }
  return ai === aSegs.length;
}

function segMatch(pattern, segment) {
  // Single-segment match: *, ?, [abc] only.
  return charMatch(pattern, 0, segment, 0);
}

function charMatch(pat, pi, str, si) {
  while (pi < pat.length) {
    const p = pat[pi];
    if (p === '*') {
      // Zero or more chars within this segment.
      // Collapse runs of '*' to one.
      while (pi + 1 < pat.length && pat[pi + 1] === '*') pi += 1;
      if (pi + 1 === pat.length) return true; // trailing * swallows rest
      for (let k = si; k <= str.length; k++) {
        if (charMatch(pat, pi + 1, str, k)) return true;
      }
      return false;
    }
    if (p === '?') {
      if (si >= str.length) return false;
      pi += 1;
      si += 1;
      continue;
    }
    if (p === '[') {
      // Character class. Find closing ].
      const close = pat.indexOf(']', pi + 1);
      if (close === -1) {
        // Treat literal [.
        if (si >= str.length || str[si] !== '[') return false;
        pi += 1;
        si += 1;
        continue;
      }
      const cls = pat.slice(pi + 1, close);
      if (si >= str.length) return false;
      const c = str[si];
      let matched = false;
      let negate = false;
      let body = cls;
      if (body.startsWith('!') || body.startsWith('^')) {
        negate = true;
        body = body.slice(1);
      }
      for (let k = 0; k < body.length; k++) {
        if (body[k + 1] === '-' && k + 2 < body.length) {
          if (c >= body[k] && c <= body[k + 2]) {
            matched = true;
            break;
          }
          k += 2;
        } else if (body[k] === c) {
          matched = true;
          break;
        }
      }
      if (matched === negate) return false;
      pi = close + 1;
      si += 1;
      continue;
    }
    if (si >= str.length) return false;
    if (p !== str[si]) return false;
    pi += 1;
    si += 1;
  }
  return si === str.length;
}

// ---------- matchesDeny ----------

export function matchesDeny(absPath) {
  for (const p of DENY_PREFIXES) {
    if (absPath === p) return p;
    const withSlash = p.endsWith('/') ? p : p + '/';
    if (absPath.startsWith(withSlash)) return p;
  }
  for (const g of DENY_GLOBS) {
    if (globMatch(absPath, g)) return g;
  }
  return null;
}

// ---------- resolvePath ----------

/**
 * resolvePath(rawValue, cwd, allowedPrefixes) →
 *   { ok: true, lexical, resolved, real } |
 *   { ok: false, reason, detail? }
 *
 * Order: empty → must_be_absolute → path.resolve → realpathSync (ENOENT
 * falls back to resolved) → DENY-on-real (and lexical) → ALLOW-on-real.
 */
export function resolvePath(rawValue, cwd, allowedPrefixes) {
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    return { ok: false, reason: 'empty_path' };
  }
  if (!path.isAbsolute(rawValue)) {
    return {
      ok: false,
      reason: 'must_be_absolute',
      detail: { lexical: rawValue },
    };
  }
  const resolved = path.resolve(cwd, rawValue);
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      real = resolved;
    } else {
      return {
        ok: false,
        reason: 'realpath_failed',
        detail: {
          lexical: rawValue,
          resolved,
          errCode: err && err.code,
        },
      };
    }
  }
  // DENY-on-real first; then DENY-on-resolved as a defensive second
  // check (the realpath substitution in the spawn layer closes the
  // residual TOCTOU race, but the lexical check belt-and-braces).
  const denyHit = matchesDeny(real) || matchesDeny(resolved);
  if (denyHit) {
    return {
      ok: false,
      reason: 'path_denied',
      detail: {
        lexical: rawValue,
        resolved,
        real,
        matchedDeny: denyHit,
      },
    };
  }
  const inAllow = allowedPrefixes.some(
    (p) => real === p || real.startsWith(p.endsWith('/') ? p : p + '/'),
  );
  if (!inAllow) {
    return {
      ok: false,
      reason: 'not_in_allow_prefix',
      detail: {
        lexical: rawValue,
        resolved,
        real,
        allowedPrefixes,
      },
    };
  }
  return { ok: true, lexical: rawValue, resolved, real };
}

// ---------- Verb schemas ----------

const PATH_SCHEMA_QCLAW = Object.freeze({
  kind: 'path',
  allowedPrefixes: ['/root/QClaw'],
});

export const VERB_SCHEMAS = Object.freeze({
  ls: {
    allowedFlags: [
      { spelling: '-l', kind: 'bool-flag' },
      { spelling: '-a', kind: 'bool-flag' },
      { spelling: '-h', kind: 'bool-flag' },
      { spelling: '--all', kind: 'bool-flag' },
      { spelling: '--human-readable', kind: 'bool-flag' },
    ],
    positional: {
      min: 0,
      max: 8,
      perArgSchema: PATH_SCHEMA_QCLAW,
    },
    maxArgvLength: 16,
  },
  cat: {
    allowedFlags: [],
    positional: {
      min: 1,
      max: 3,
      perArgSchema: PATH_SCHEMA_QCLAW,
    },
    maxArgvLength: 4,
  },
  'git status': {
    allowedFlags: [],
    positional: { min: 0, max: 0 },
    maxArgvLength: 2,
  },
  'git log': {
    allowedFlags: [
      { spelling: '--oneline', kind: 'bool-flag' },
      { spelling: '--all', kind: 'bool-flag' },
      { spelling: '--graph', kind: 'bool-flag' },
      {
        spelling: '-n',
        kind: 'value-flag',
        joiner: 'space',
        valueSchema: { kind: 'int', min: 1, max: 100 },
      },
      {
        spelling: '--max-count=',
        kind: 'value-flag',
        joiner: 'eq',
        valueSchema: { kind: 'int', min: 1, max: 100 },
      },
    ],
    positional: { min: 0, max: 0 },
    maxArgvLength: 7,
  },
  'pm2 list': {
    allowedFlags: [],
    positional: { min: 0, max: 0 },
    maxArgvLength: 2,
  },
});

// ---------- Repo-local-git-config dangerous-key catcher ----------
//
// DANGEROUS_KEYS is tied to the v1 verb surface (status/log); see design
// Appendix A for EXCLUDED keys that promote into this list when verbs
// expand (round-4 LOW L4.3).
//
// `git config --list --local` flattens every key to dotted form. The
// regression test reads the live config and asserts none of these
// catchers fire.
//
// Catcher 1 — exact flat keys (per `[section] key`):
export const DANGEROUS_GIT_CONFIG_EXACT_KEYS = Object.freeze([
  'core.fsmonitor',
  'gpg.program',
  'gpg.openpgp.program',
  'gpg.x509.program',
  'gpg.ssh.program',
  'include.path',                  // [include] path = ... (round-3 Blocker 1)
]);

// Catcher 2 — leaf names (last segment of dotted key). Catches things
// like filter.<n>.clean, filter.<n>.smudge, credential.helper, etc.
// `clean` and `smudge` added per round-3 Blocker 2.
export const DANGEROUS_GIT_CONFIG_LEAVES = Object.freeze([
  'command',
  'program',
  'driver',
  'textconv',
  'helper',
  'execute',
  'clean',
  'smudge',
]);

// Catcher 3 — section prefixes. Any flat key whose section starts with
// one of these is rejected, regardless of leaf name. Includes the
// `include` and `includeIf` sections per round-3 Blocker 1.
export const DANGEROUS_GIT_CONFIG_SECTIONS = Object.freeze([
  'include',                                 // include.path = ... → reject
  'includeIf',                               // includeIf.<cond>.path → reject
]);

// Catcher 4 — alias-specific rules. Alias whose value starts with `!` is
// rejected (arbitrary shell). Alias whose name is `status` or `log`
// (the v1 verb whitelist) is rejected — pre-2.30 git would override the
// built-in.
export const DANGEROUS_GIT_CONFIG_ALIAS_NAMES = Object.freeze([
  'status',
  'log',
]);

// Catcher 5 — section prefixes that require leaf inspection (textconv,
// driver, etc). `[diff "<glob>"] textconv` and `[merge "<glob>"] driver`
// flatten to `diff.<glob>.textconv` / `merge.<glob>.driver`. These are
// caught by the leaf catcher above (`textconv`, `driver`), but listed
// here for documentation completeness.

// Documented exclusions — these keys are NOT flagged in v1 but should
// be revisited when the verb surface expands:
//   - core.sshCommand  (remote ops only — not in v1)
//   - pager.*          (neutralised by SAFE_ENV.GIT_PAGER='cat' in git ≥ 2.30)
//   - core.hooksPath   (hooks don't fire on status/log; revisit if v1.x
//                       adds commit/push/checkout)
//   - credential.*     EXCEPTION CLASS — `credential.helper` is intentionally
//                       caught by the `helper` leaf catcher above. If an
//                       operator legitimately needs a credential helper
//                       (e.g. `git-credential-store` for a service account
//                       password), the failure message names
//                       `credential.helper` so the operator knows where to
//                       look. Add a documented exception in the test file
//                       with a review-trail comment if legit.
