/**
 * QuantumClaw — shell_exec argv parser + schema validator (Slice 3d)
 *
 * Pure, hand-rolled, ESM, ASCII-only, zero-dep. Pure function:
 *   parseAndValidate(commandString) →
 *     { ok: true, argv, schemaKey, resolvedPaths } |
 *     { ok: false, error, reason, detail? }
 *
 * No env access, no filesystem access, no spawn, no bash. The parser is
 * a 7-bit ASCII state machine (DEFAULT, IN_SINGLE, IN_DOUBLE). All shell
 * metacharacters are rejected structurally — the round-1-3 R1..R4
 * bypasses (newline chain, $HOME, ~, awk system(), sed e/r/w, sort
 * --compress-program, find -fls, process substitution) reject at parse
 * time or at schema dispatch with explicit reasons.
 *
 * Schema validation (after parse) lives in shell-exec-verb-schemas.js —
 * this file imports the schemas and the path resolver, applies them per
 * verb, and returns the structured result.
 *
 * Design SSOT: /tmp/slice3d_design.md (v4 — 4 rounds of adversarial
 * review). Do NOT add new metacharacter cases without revisiting the
 * design.
 */

import {
  VERB_SCHEMAS,
  VERB_BINARY,
  resolvePath,
} from './shell-exec-verb-schemas.js';

const MAX_INPUT_BYTES = 8192;
const ALLOWED_CWD = '/root/QClaw';

// ---------- Pre-tokenisation sanity checks ----------

function preScan(command) {
  if (typeof command !== 'string') {
    return { ok: false, error: 'parse_error', reason: 'not_a_string' };
  }
  if (command.length > MAX_INPUT_BYTES) {
    return {
      ok: false,
      error: 'parse_error',
      reason: 'too_long',
      detail: { length: command.length, cap: MAX_INPUT_BYTES },
    };
  }
  const nulIdx = command.indexOf('\0');
  if (nulIdx !== -1) {
    return {
      ok: false,
      error: 'parse_error',
      reason: 'null_byte',
      detail: { index: nulIdx },
    };
  }
  // ASCII-only: reject any code unit > 0x7E or any byte <0x20 that
  // isn't \t (0x09), \n (0x0A), or \r (0x0D). The state machine then
  // rejects \n/\r as `newline` — they pass the ASCII scan but are
  // not accepted tokens.
  for (let i = 0; i < command.length; i++) {
    const c = command.charCodeAt(i);
    if (c > 0x7e) {
      return {
        ok: false,
        error: 'parse_error',
        reason: 'non_ascii',
        detail: { index: i, codepoint: c },
      };
    }
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) {
      return {
        ok: false,
        error: 'parse_error',
        reason: 'non_ascii',
        detail: { index: i, codepoint: c },
      };
    }
  }
  return { ok: true };
}

// ---------- State machine tokeniser ----------

const STATE_DEFAULT = 0;
const STATE_SINGLE = 1;
const STATE_DOUBLE = 2;

function rejFeature(reason, index, extra = {}) {
  return {
    ok: false,
    error: 'rejected_feature',
    reason,
    detail: { index, ...extra },
  };
}

function parseErr(reason, index, extra = {}) {
  return {
    ok: false,
    error: 'parse_error',
    reason,
    detail: { index, ...extra },
  };
}

export function parse(command) {
  const pre = preScan(command);
  if (!pre.ok) return pre;

  const argv = [];
  let buf = '';
  let bufferStarted = false;
  let state = STATE_DEFAULT;

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    const cc = command.charCodeAt(i);

    if (state === STATE_DEFAULT) {
      // Whitespace token boundary
      if (c === ' ' || c === '\t') {
        if (bufferStarted) {
          argv.push(buf);
          buf = '';
          bufferStarted = false;
        }
        continue;
      }
      // Newline / CR / other low control bytes — reject as newline
      if (c === '\n' || c === '\r' || (cc < 0x20 && cc !== 0x09)) {
        return rejFeature('newline', i);
      }
      // Command chain separators
      if (c === ';' || c === '|' || c === '&') {
        return rejFeature('command_separator', i, { token: c });
      }
      // Redirects
      if (c === '<' || c === '>') {
        return rejFeature('redirect', i, { token: c });
      }
      // Subshell
      if (c === '(' || c === ')') {
        return rejFeature('subshell', i, { token: c });
      }
      // Variable expansion
      if (c === '$') {
        return rejFeature('variable_expansion', i);
      }
      // Command substitution
      if (c === '`') {
        return rejFeature('command_substitution', i);
      }
      // Tilde — only special at start of token
      if (c === '~' && !bufferStarted) {
        return rejFeature('tilde_expansion', i);
      }
      // Glob / brace
      if (c === '*' || c === '?' || c === '[' || c === ']' || c === '{' || c === '}') {
        return rejFeature('glob_or_brace', i, { token: c });
      }
      // Comment — only at start of token
      if (c === '#' && !bufferStarted) {
        return rejFeature('comment', i);
      }
      // Single quote
      if (c === "'") {
        state = STATE_SINGLE;
        bufferStarted = true;
        continue;
      }
      // Double quote
      if (c === '"') {
        state = STATE_DOUBLE;
        bufferStarted = true;
        continue;
      }
      // Backslash escape
      if (c === '\\') {
        if (i + 1 >= command.length) {
          return parseErr('dangling_escape', i);
        }
        const next = command[i + 1];
        if (next === '\n' || next === '\r') {
          return rejFeature('line_continuation', i);
        }
        buf += next;
        bufferStarted = true;
        i += 1;
        continue;
      }
      // Literal byte
      buf += c;
      bufferStarted = true;
      continue;
    }

    if (state === STATE_SINGLE) {
      if (c === '\n' || c === '\r') {
        return rejFeature('newline', i);
      }
      if (c === "'") {
        state = STATE_DEFAULT;
        // bufferStarted stays true
        continue;
      }
      buf += c;
      continue;
    }

    if (state === STATE_DOUBLE) {
      if (c === '\n' || c === '\r') {
        return rejFeature('newline', i);
      }
      if (c === '"') {
        state = STATE_DEFAULT;
        continue;
      }
      if (c === '$') {
        return rejFeature('variable_expansion', i);
      }
      if (c === '`') {
        return rejFeature('command_substitution', i);
      }
      if (c === '\\') {
        if (i + 1 >= command.length) {
          return parseErr('dangling_escape', i);
        }
        const next = command[i + 1];
        if (next === '\n' || next === '\r') {
          return rejFeature('line_continuation', i);
        }
        // POSIX double-quote escape: only \, ", $, ` (and newline) are
        // escape pairs. $ and ` are unreachable here (we reject them
        // above). For " and \ we consume the next char as literal.
        // For any other char, we preserve BOTH the backslash AND the
        // next char as literals.
        if (next === '"' || next === '\\') {
          buf += next;
          i += 1;
          continue;
        }
        buf += '\\';
        buf += next;
        i += 1;
        continue;
      }
      buf += c;
      continue;
    }
  }

  // End of input
  if (state === STATE_SINGLE) {
    return parseErr('unterminated_single_quote', command.length);
  }
  if (state === STATE_DOUBLE) {
    return parseErr('unterminated_double_quote', command.length);
  }
  if (bufferStarted) {
    argv.push(buf);
  }

  return { ok: true, argv };
}

// ---------- Verb dispatch ----------

function dispatchVerb(argv) {
  if (!argv || argv.length === 0) {
    return { ok: false, error: 'unknown_verb', reason: 'empty_argv' };
  }
  const first = argv[0];

  // Two-token verbs (git X, pm2 X)
  if (first === 'git' || first === 'pm2') {
    if (argv.length < 2) {
      return {
        ok: false,
        error: 'unknown_verb',
        reason: 'missing_subcommand',
        detail: { verb: first },
      };
    }
    const second = argv[1];
    // pm2 ls is an alias for pm2 list
    let key;
    if (first === 'pm2' && second === 'ls') key = 'pm2 list';
    else key = `${first} ${second}`;
    if (!VERB_SCHEMAS[key]) {
      return {
        ok: false,
        error: 'unknown_verb',
        reason: 'verb_not_in_v1',
        detail: { verb: `${first} ${second}` },
      };
    }
    return { ok: true, schemaKey: key, verbTokens: 2 };
  }

  // One-token verbs
  if (!VERB_SCHEMAS[first]) {
    return {
      ok: false,
      error: 'unknown_verb',
      reason: 'verb_not_in_v1',
      detail: { verb: first },
    };
  }
  return { ok: true, schemaKey: first, verbTokens: 1 };
}

// ---------- Schema application ----------

function isAllowedShortFlag(token, schema) {
  // A token like "-l" is an allowed short flag iff it's listed in
  // schema.allowedFlags exactly.
  return (schema.allowedFlags || []).some(
    (f) => f.spelling === token,
  );
}

function findFlagSpec(token, schema) {
  return (schema.allowedFlags || []).find((f) => f.spelling === token);
}

function findEqJoinerFlagSpec(token, schema) {
  // For value-flags with joiner='eq', the token has the form
  // `--name=value`. Match the prefix `--name=`.
  for (const f of schema.allowedFlags || []) {
    if (f.kind === 'value-flag' && f.joiner === 'eq') {
      if (token.startsWith(f.spelling)) return f;
    }
  }
  return null;
}

function isLikelyCombinedShort(token, schema) {
  // /^-[a-zA-Z]{2,}$/ AND not a known long-flag-with-double-dash AND
  // not a known exact short flag.
  if (!/^-[a-zA-Z]{2,}$/.test(token)) return false;
  if (isAllowedShortFlag(token, schema)) return false;
  return true;
}

function applySchema(argv, dispatch, schema) {
  // Walk argv after the verb tokens. Partition into flags + positionals.
  const verbN = dispatch.verbTokens;
  const positionalSchema = schema.positional || { min: 0, max: 0 };
  const positionalIndices = [];
  const positionals = [];

  // Enforce argv length cap (defence against pathological inputs that
  // pass parse but balloon argv).
  if (typeof schema.maxArgvLength === 'number' && argv.length > schema.maxArgvLength) {
    return {
      ok: false,
      error: 'too_many_arguments',
      reason: 'argv_length_cap',
      detail: { len: argv.length, cap: schema.maxArgvLength },
    };
  }

  let i = verbN;
  while (i < argv.length) {
    const tok = argv[i];
    // Empty token (from `ls ''` etc) — treat as positional and let the
    // positional schema reject. (PathSchema rejects empty; bare empty
    // tokens fall through.)
    if (tok.length > 0 && tok[0] === '-') {
      // Combined-short-flag detection FIRST so that e.g. `-la` rejects
      // with a clearer reason than "invalid_flag".
      if (isLikelyCombinedShort(tok, schema)) {
        return {
          ok: false,
          error: 'invalid_flag',
          reason: 'combined_short_flags',
          detail: {
            token: tok,
            hint: `split into separate flags, e.g. ${tok.slice(0, 2)} -${tok.slice(2)}`,
          },
        };
      }
      // value-flag with joiner=eq: token like --max-count=50
      const eqFlag = findEqJoinerFlagSpec(tok, schema);
      if (eqFlag) {
        const value = tok.slice(eqFlag.spelling.length);
        const vRes = validateFlagValue(eqFlag, value);
        if (!vRes.ok) return vRes;
        i += 1;
        continue;
      }
      const fSpec = findFlagSpec(tok, schema);
      if (!fSpec) {
        return {
          ok: false,
          error: 'invalid_flag',
          reason: 'flag_not_in_v1',
          detail: { token: tok, verb: dispatch.schemaKey },
        };
      }
      if (fSpec.kind === 'bool-flag') {
        i += 1;
        continue;
      }
      if (fSpec.kind === 'value-flag') {
        if (fSpec.joiner === 'space') {
          if (i + 1 >= argv.length) {
            return {
              ok: false,
              error: 'invalid_flag_value',
              reason: 'missing_value',
              detail: { flag: tok },
            };
          }
          const value = argv[i + 1];
          const vRes = validateFlagValue(fSpec, value);
          if (!vRes.ok) return vRes;
          i += 2;
          continue;
        }
        // joiner=eq but exact-match token (e.g. just `--max-count` with
        // no `=value`) — missing value.
        return {
          ok: false,
          error: 'invalid_flag_value',
          reason: 'missing_value',
          detail: { flag: tok },
        };
      }
      // Unknown flag-kind
      return {
        ok: false,
        error: 'invalid_flag',
        reason: 'unknown_flag_kind',
        detail: { token: tok },
      };
    }
    // Positional
    positionals.push(tok);
    positionalIndices.push(i);
    i += 1;
  }

  // Positional count check
  if (positionals.length < (positionalSchema.min ?? 0)) {
    return {
      ok: false,
      error: 'too_few_arguments',
      reason: 'positional_count_below_min',
      detail: { got: positionals.length, min: positionalSchema.min },
    };
  }
  if (positionals.length > (positionalSchema.max ?? 0)) {
    return {
      ok: false,
      error: 'too_many_arguments',
      reason: 'positional_count_above_max',
      detail: { got: positionals.length, max: positionalSchema.max },
    };
  }

  // Per-positional validation. For PathSchema, defer to resolvePath
  // (filesystem access). Build resolvedPaths map keyed by absolute
  // argv index.
  const resolvedPaths = new Map();
  if (positionalSchema.perArgSchema && positionalSchema.perArgSchema.kind === 'path') {
    for (let p = 0; p < positionals.length; p++) {
      const lexical = positionals[p];
      const argvIndex = positionalIndices[p];
      const res = resolvePath(
        lexical,
        ALLOWED_CWD,
        positionalSchema.perArgSchema.allowedPrefixes,
      );
      if (!res.ok) {
        // path_denied / not_in_allow_prefix are their own error
        // categories; other reasons (empty_path, must_be_absolute,
        // realpath_failed) wrap as invalid_argument.
        if (res.reason === 'path_denied' || res.reason === 'not_in_allow_prefix') {
          return {
            ok: false,
            error: res.reason,
            reason: res.reason,
            detail: { ...res.detail, positionalIndex: p },
          };
        }
        return {
          ok: false,
          error: 'invalid_argument',
          reason: res.reason,
          detail: { ...(res.detail || {}), lexical, positionalIndex: p },
        };
      }
      resolvedPaths.set(argvIndex, res.real);
    }
  }

  return { ok: true, resolvedPaths };
}

function validateFlagValue(fSpec, value) {
  const vs = fSpec.valueSchema;
  if (!vs) return { ok: true };
  if (value === undefined || value === null || value === '') {
    return {
      ok: false,
      error: 'invalid_flag_value',
      reason: 'empty_value',
      detail: { flag: fSpec.spelling, got: value },
    };
  }
  if (vs.kind === 'int') {
    if (!/^[0-9]+$/.test(value)) {
      return {
        ok: false,
        error: 'invalid_flag_value',
        reason: `flag ${fSpec.spelling} requires an integer value; got '${value}'`,
        detail: { flag: fSpec.spelling, got: value },
      };
    }
    const n = parseInt(value, 10);
    if (n < (vs.min ?? -Infinity) || n > (vs.max ?? Infinity)) {
      return {
        ok: false,
        error: 'invalid_flag_value',
        reason: 'out_of_range',
        detail: { flag: fSpec.spelling, got: n, min: vs.min, max: vs.max },
      };
    }
    return { ok: true };
  }
  // Fail-closed for any valueSchema.kind not handled above. Current
  // schemas only declare kind:'int' (round-1 code review LOW L3), so
  // this is dead in v1 — but future schema additions that forget to
  // extend this function would otherwise silently accept any value.
  return {
    ok: false,
    error: 'invalid_flag_value',
    reason: 'unsupported_value_schema',
    detail: { kind: vs.kind },
  };
}

// ---------- Public entry ----------

export function parseAndValidate(command) {
  const parsed = parse(command);
  if (!parsed.ok) return parsed;
  const dispatch = dispatchVerb(parsed.argv);
  if (!dispatch.ok) return dispatch;
  const schema = VERB_SCHEMAS[dispatch.schemaKey];
  const validated = applySchema(parsed.argv, dispatch, schema);
  if (!validated.ok) return validated;
  return {
    ok: true,
    argv: parsed.argv,
    schemaKey: dispatch.schemaKey,
    verbTokens: dispatch.verbTokens,
    resolvedPaths: validated.resolvedPaths,
    binary: VERB_BINARY[parsed.argv[0]],
  };
}

// Helper for tool body — short hint string keyed by the rejection.
export function suggestFor(rejection) {
  if (!rejection || rejection.ok) return null;
  if (rejection.error === 'unknown_verb') {
    return 'allowed verbs (v1): ls, cat, git status, git log, pm2 list. For other shell ops use claude_code_dispatch.';
  }
  if (rejection.error === 'invalid_flag' && rejection.reason === 'combined_short_flags') {
    return rejection.detail?.hint || 'split combined short flags, e.g. -la → -l -a';
  }
  if (rejection.error === 'rejected_feature') {
    return `shell feature '${rejection.reason}' is not supported by shell_exec v1. Use claude_code_dispatch for complex shell ops.`;
  }
  if (rejection.error === 'path_denied') {
    return `path '${rejection.detail?.lexical}' resolves into a DENY-listed surface (${rejection.detail?.matchedDeny}); not readable through shell_exec.`;
  }
  if (rejection.error === 'not_in_allow_prefix') {
    return `path '${rejection.detail?.lexical}' is outside the v1 ALLOW prefix for this verb (${(rejection.detail?.allowedPrefixes || []).join(', ')}).`;
  }
  if (rejection.error === 'invalid_argument') {
    return `argument failed validation (${rejection.reason}).`;
  }
  if (rejection.error === 'invalid_flag_value') {
    return rejection.reason;
  }
  if (rejection.error === 'parse_error') {
    return `command failed parse (${rejection.reason}); shell_exec v1 is ASCII-only with no metacharacters.`;
  }
  return null;
}
