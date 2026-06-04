/**
 * Slice 4 — runtime verification gates.
 *
 * Structural + evidentiary checks on Charlie's assembled natural-language
 * response, run synchronously in-process (NO verification LLM). Closes failure
 * Pattern D (phantom tool) structurally, Pattern C (false completion) for
 * entity-bearing claims, and the state subset of Pattern A. Gates FAIL CLOSED:
 * a gate that throws is treated as a hard-fail, never a pass.
 *
 * Unit 1 ships the framework + shared detection/evidence helpers + Gate 4
 * (tool reference). Gates 1/3/2 (completion/state/delegation) are added to
 * GATES in Unit 2. Integration into _processNonReflex + the regeneration loop
 * is Unit 3.
 *
 * Kill-switch: `QCLAW_GATES_ENABLED=0|false` → runGates returns pass immediately
 * (escape hatch for a deterministically-throwing gate; default ON).
 *
 * Design ref: /tmp/slice4_design.md §2, §2.5, §3.
 */

import { parseAuditTs } from '../security/audit.js';

// ── §2.5 detection helpers ────────────────────────────────────────────────

/** Split prose into sentences (on ., !, ?, newline). Keeps it simple + robust. */
export function splitSentences(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Remove code-fenced spans, inline-code spans, and blockquote lines. Gate-4 only. */
export function stripCodeSpans(text) {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' ')      // fenced blocks
    .replace(/`[^`]*`/g, ' ')             // inline code
    .replace(/^\s*>.*$/gm, ' ');          // blockquotes
}

const NEG_RE = /\b(not|n't|never|no longer|isn't|wasn't|aren't|weren't|haven't|hasn't|didn't|won't|cannot|can't)\b/i;
// Copula-initial → interrogative ONLY when a subject follows (e.g. "is it
// working", "did the workflow run"). NOT "Is working on it" / "Has shipped" —
// those are declarative status lines with an elided subject and must NOT be
// suppressed (they're real claims). True "?" questions are caught separately.
const INTERROG_OPEN_RE = /^\s*(is|are|was|were|does|do|did|can|could|will|would|should|has|have|had)\s+(i|we|you|he|she|it|they|the|that|this|there|my|your|our|their|his|her|everything|all)\b/i;
const FUTURE_RE = /\b(will|'ll|going to|gonna|about to|plan to|planning to|intend to|i'll|we'll|let me|once|after we|before we|if)\b/i;

/**
 * §2.5 conservative suppression: a sentence does NOT fire a gate when it is
 * negated, interrogative, future/modal/conditional, or fully quoted. Only an
 * asserted, present/past, unquoted claim fires.
 */
export function isSuppressed(sentence) {
  const s = (sentence || '').trim();
  if (!s) return true;
  if (s.endsWith('?')) return true;                 // interrogative
  if (INTERROG_OPEN_RE.test(s)) return true;         // "is it working", "did X"
  if (NEG_RE.test(s)) return true;                   // "not done"
  if (FUTURE_RE.test(s)) return true;                // "I'll deploy", "once X"
  // fully quoted (the whole assertion is inside one pair of quotes)
  if (/^["'“‘].*["'”’]$/.test(s)) return true;
  return false;
}

// ── §2.5 entity-aware evidence matching ───────────────────────────────────

const ENTITY_PATTERNS = [
  /\b(?=[A-Za-z0-9_-]*[0-9_-])[A-Za-z0-9_-]{12,}\b/g, // long ids — MUST contain a digit/_/- (excludes dictionary words like "successfully","configuration")
  /\b[a-z]{2,}_[A-Za-z0-9]{6,}\b/g,          // prefixed ids (stripe/ghl style)
  /\b\d{6,}\b/g,                             // bare digit-runs (ghl numeric ids)
  /\b(?:charlie__|shared__)?[a-z0-9]+(?:__[a-z0-9-]+)+\b/g, // tool names
  /\/[\w./-]+\.\w+\b/g,                       // file paths
  /"([^"]{3,})"|'([^']{3,})'/g,              // quoted proper nouns (bare Capitalized words dropped — too noisy / substring false-positives)
];

/** Extract candidate entity tokens from a claim sentence (broadened, §2.5 step 1). */
export function extractEntities(sentence) {
  const out = new Set();
  for (const re of ENTITY_PATTERNS) {
    for (const m of (sentence || '').matchAll(re)) {
      const tok = (m[1] || m[2] || m[0] || '').trim();
      if (tok.length >= 3) out.add(tok);
    }
  }
  return [...out];
}

/** Parse the embedded tool-call id from a row's detail (`{"id":...}`), or null. */
function _callId(row) {
  try { return JSON.parse(row.detail).id ?? null; } catch { return null; }
}

/**
 * Correlate raw tool events into {call, result} pairs by **tool-call id**
 * (embedded in `detail` by index.js), which is robust to interleaving when
 * agents run tools concurrently. Falls back to nearest-same-action only when
 * an id is absent (legacy rows). A call row is consumed at most once (dedup),
 * so one call can't back two results.
 */
export function correlatePairs(events) {
  const pairs = [];
  const evs = Array.isArray(events) ? events : [];
  const usedCallIdx = new Set();
  for (let i = 0; i < evs.length; i++) {
    const r = evs[i];
    if (r.result_status == null) continue;           // not a result row
    const rid = _callId(r);
    let matchIdx = -1;
    for (let j = i + 1; j < evs.length; j++) {
      if (usedCallIdx.has(j) || evs[j].result_status != null || evs[j].action !== r.action) continue;
      const cid = _callId(evs[j]);
      if (rid != null && cid != null) { if (cid === rid) { matchIdx = j; break; } }
      else if (matchIdx === -1) { matchIdx = j; }     // no-id fallback: nearest same-action
    }
    if (matchIdx >= 0) { usedCallIdx.add(matchIdx); pairs.push({ call: evs[matchIdx], result: r }); }
  }
  return pairs;
}

/**
 * §2.5 entity-aware match. `requireStatus`: 'success' (completion/character) or
 * 'nonnull' (probe "ran"). Entity token must appear in the CALL row's args
 * (`detail`); falls back to a this-turn relevant-tool pair when the claim has
 * no extractable entity. Returns { backed, evidence? }.
 */
export function matchEvidence(sentence, events, { requireStatus = 'success', turnStartMs = 0, relevant = null } = {}) {
  const pairs = correlatePairs(events);
  const statusOk = (p) => requireStatus === 'success'
    ? p.result.result_status === 'success'
    : p.result.result_status != null;
  const candidates = pairs.filter(statusOk);
  const entities = extractEntities(sentence);

  if (entities.length) {
    for (const p of candidates) {
      // Evidence must not pre-date the turn (design §2: a regenerated claim
      // can't be backed by a prior attempt's / earlier turn's tool rows).
      if (parseAuditTs(p.result.timestamp) < turnStartMs) continue;
      const args = String(p.call.detail || '');
      if (entities.some(e => args.includes(e))) return { backed: true, evidence: p };
    }
    return { backed: false };
  }
  // no-entity fallback: a this-turn pair for a verb-relevant tool
  for (const p of candidates) {
    const ts = parseAuditTs(p.result.timestamp);
    if (ts >= turnStartMs && (!relevant || relevant(p.result.action))) {
      return { backed: true, evidence: p, weak: true };
    }
  }
  return { backed: false };
}

// ── Gate 4 — tool reference (structural) ──────────────────────────────────

const TOOL_NAME_RE = /\b(?:charlie__|shared__)?[a-z0-9]+(?:__[a-z0-9-]+)+\b/g;
const LEGACY_TOOL_NAMES = ['claude_code_dispatch', 'n8n_workflow_update', 'shell_exec'];

/**
 * Gate 4: every tool name referenced in PROSE must resolve in the registry.
 * Code-fenced/inline-code spans are stripped first (examples/instructions in
 * code don't trip it). Unresolved reference → hard_fail (phantom tool). Folds
 * Brief-12 Gate 5: out-of-scope == does-not-exist for prose references; call-
 * time scope enforcement is Slice 3b's job.
 */
export function gateToolReference(response, ctx) {
  const { toolRegistry } = ctx;
  const prose = stripCodeSpans(response || '');
  const names = new Set();
  for (const m of prose.matchAll(TOOL_NAME_RE)) names.add(m[0]);
  for (const legacy of LEGACY_TOOL_NAMES) {
    if (new RegExp(`\\b${legacy}\\b`).test(prose)) names.add(legacy);
  }
  const phantom = [...names].filter(n => !(toolRegistry && typeof toolRegistry.has === 'function' && toolRegistry.has(n)));
  if (phantom.length === 0) {
    return { gate: 'tool_reference', fired: false };
  }
  return {
    gate: 'tool_reference',
    fired: true,
    severity: 'hard',
    claims: phantom.map(n => ({ text: n, verification_attempted: true, verified: false })),
    action: 'reprompt',
    reason: `unresolved tool reference(s): ${phantom.join(', ')}`,
  };
}

// ── Gates 1 / 3 / 2 — evidentiary + delegation (Unit 2) ───────────────────

// Hyphen-aware boundaries (?<![\w-])…(?![\w-]) so hyphenated compounds like
// "completed-tasks" / "auto-deploy" don't false-fire (P2 over-fire).
const COMPLETION_RE = /(?<![\w-])(done|finished|complete|completed|shipped|deployed|fixed|resolved|merged|published|posted|sent|successfully)(?![\w-])/i;
const STATE_RE = /(?<![\w-])(running|live|active|online|enabled|connected|working|up|healthy|passed|succeeded|successful|stable)(?![\w-])/i;
// Characterization (needs a SUCCESS probe; an errored probe → hard_fail). Liveness
// words moved here (R: "running" backed by an errored probe was a false-pass).
const CHARACTERIZATION_RE = /(?<![\w-])(running|live|active|online|connected|up|enabled|healthy|passed|succeeded|successful|working|ok|fine|good|stable)(?![\w-])/i;
const DELEGATION_RE = /(?<![\w-])(dispatched|delegated|handed off|handed it off|is working on it|kicked off)(?![\w-])/i;

// no-entity-fallback relevance: which tools plausibly back which claim class.
const isCompletionTool = (n) => /write|edit|update|create|deploy|post|publish|send|merge|workflow_update|shell_exec/i.test(n || '');
const isStateTool = (n) => /get_|list_|search|read|status|executions|pm2|shell_exec/i.test(n || '');

/** Non-suppressed sentences that match a verb class. */
function detectClaims(response, verbRe) {
  return splitSentences(response).filter(s => !isSuppressed(s) && verbRe.test(s));
}

function windowEvents(ctx, windowMin) {
  // cutoff = max(now - window, turnStart) when turnStart is known, so a
  // prior-attempt / earlier-turn row can't enter the evidence set (design §2).
  const base = ctx.now - windowMin * 60_000;
  const cutoffMs = (ctx.turnStartMs != null) ? Math.max(base, ctx.turnStartMs) : base;
  const cutoffIso = new Date(cutoffMs).toISOString();
  return (ctx.auditLog && typeof ctx.auditLog.toolEventsSince === 'function')
    ? ctx.auditLog.toolEventsSince(cutoffIso)
    : [];
}

/** Gate 1 — completion: each claim needs a backing success tool result (entity-aware). */
export function gateCompletion(response, ctx) {
  const claims = detectClaims(response, COMPLETION_RE);
  if (!claims.length) return { gate: 'completion', fired: false };
  const events = windowEvents(ctx, ctx.windowMinComplete);
  const unbacked = [];
  for (const c of claims) {
    const m = matchEvidence(c, events, { requireStatus: 'success', turnStartMs: ctx.turnStartMs ?? 0, relevant: isCompletionTool });
    if (!m.backed) unbacked.push({ text: c, verification_attempted: true, verified: false });
  }
  if (!unbacked.length) return { gate: 'completion', fired: false };
  return { gate: 'completion', fired: true, severity: 'hard', claims: unbacked, action: 'reprompt', reason: 'completion claim without a backing success tool result' };
}

/** Gate 3 — state: probe must have RUN (nonnull); characterization needs success. */
export function gateState(response, ctx) {
  const claims = detectClaims(response, STATE_RE);
  if (!claims.length) return { gate: 'state', fired: false };
  const events = windowEvents(ctx, ctx.windowMinState);
  let anyHard = false; const fired = [];
  for (const c of claims) {
    const ran = matchEvidence(c, events, { requireStatus: 'nonnull', turnStartMs: ctx.turnStartMs ?? 0, relevant: isStateTool });
    if (!ran.backed) { fired.push({ text: c, verification_attempted: true, verified: false, severity: 'soft' }); continue; }
    if (CHARACTERIZATION_RE.test(c)) {
      const ok = matchEvidence(c, events, { requireStatus: 'success', turnStartMs: ctx.turnStartMs ?? 0, relevant: isStateTool });
      if (!ok.backed) { anyHard = true; fired.push({ text: c, verification_attempted: true, verified: false, severity: 'hard' }); } // probe ran but not success → contradicted
    }
  }
  if (!fired.length) return { gate: 'state', fired: false };
  return { gate: 'state', fired: true, severity: anyHard ? 'hard' : 'soft', claims: fired, action: anyHard ? 'reprompt' : 'rewrite', reason: anyHard ? 'characterization contradicted by tool result' : 'state claim without a probe in window' };
}

/** Gate 2 — delegation: detect-only, always fail-closed (no evidence source until Slice 5). */
export function gateDelegation(response, ctx) {
  const claims = detectClaims(response, DELEGATION_RE);
  if (!claims.length) return { gate: 'delegation', fired: false };
  // SLICE 5: wire claude_code_dispatches evidence here; until then, a past-tense
  // delegation claim is structurally unverifiable → fail closed.
  return {
    gate: 'delegation', fired: true, severity: 'hard',
    claims: claims.map(c => ({ text: c, verification_attempted: false, verified: false })),
    action: 'fail_closed_slice5_pending',
    reason: 'delegation claim unverifiable pre-Slice-5 (no dispatch evidence source)',
  };
}

// ── Framework ─────────────────────────────────────────────────────────────

const GATES = [gateToolReference, gateCompletion, gateState, gateDelegation];

function gatesEnabled() {
  const v = process.env.QCLAW_GATES_ENABLED;
  return !(v === '0' || v === 'false');
}

/**
 * Which agents the gates apply to. Default: charlie only — background/heartbeat
 * agents would otherwise pay regeneration cost (and Gate 2 would suppress their
 * normal "dispatched"/"handed off" status lines) for no benefit. Configurable
 * via QCLAW_GATES_AGENTS (comma list). This is the scoping the design's
 * `agentScope` intended; enforced at the registry wiring layer.
 */
export function isGatedAgent(name) {
  const list = (process.env.QCLAW_GATES_AGENTS || 'charlie')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(name || '').toLowerCase());
}

/**
 * Run all gates on `response`. Fail-closed: a gate that throws → synthesized
 * hard_fail. Aggregate: any hard fired → 'hard_fail'; else any soft → 'soft_fail';
 * else 'pass'. opts: { now, turnStart, windowMinComplete, windowMinState, agentScope }.
 */
export function runGates(response, auditLog, toolRegistry, opts = {}) {
  if (!gatesEnabled()) {
    return { result: 'pass', gates: [], disabled: true };
  }
  const now = opts.now || Date.now();
  const ctx = {
    auditLog, toolRegistry,
    now,
    // null (not now) when unset: windowEvents only clamps by turnStart when
    // known, so Unit-3 callers that omit it don't accidentally exclude all
    // this-turn evidence. Unit 3 MUST pass the real turn-start timestamp.
    turnStartMs: (typeof opts.turnStart === 'number') ? opts.turnStart : null,
    windowMinComplete: opts.windowMinComplete ?? 10,
    windowMinState: opts.windowMinState ?? 5,
    agentScope: opts.agentScope || null,
  };

  const results = [];
  for (const gate of GATES) {
    try {
      results.push(gate(response, ctx));
    } catch (err) {
      results.push({
        gate: gate.name || 'unknown', fired: true, severity: 'hard',
        claims: [{ text: '(gate threw)', verification_attempted: true, verified: false }],
        action: 'reprompt', reason: `gate threw: ${err.message}`,
      });
    }
  }

  const fired = results.filter(r => r.fired);
  let result = 'pass';
  if (fired.some(r => r.severity === 'hard')) result = 'hard_fail';
  else if (fired.some(r => r.severity === 'soft')) result = 'soft_fail';

  return { result, gates: results };
}

// ── Regeneration loop (Unit 3) ────────────────────────────────────────────

const SOFT_HEDGE = "[Unverified — I don't have a confirmed tool result for that this turn; let me check and confirm before stating it.]";

/** Replace each SOFT-fired claim sentence with a fixed hedge (no surgical leak). */
export function hedgeResponse(response, gateOut) {
  let out = response;
  for (const g of (gateOut.gates || [])) {
    if (!g.fired || g.severity !== 'soft') continue;
    for (const c of (g.claims || [])) {
      const t = c.text || '';
      if (t && out.includes(t)) out = out.split(t).join(SOFT_HEDGE);
    }
  }
  return out;
}

/** Augmented re-prompt note for a hard_fail (lists the unbacked claims). */
export function buildRepromptNote(gateOut) {
  const lines = [];
  for (const g of (gateOut.gates || [])) {
    if (g.fired && g.severity === 'hard') for (const c of (g.claims || [])) lines.push(`- "${c.text}" (gate: ${g.gate})`);
  }
  return `Your previous reply made statement(s) I could not verify against this turn's tool results:\n${lines.join('\n')}\n` +
    `Revise: state only what a tool result or probe THIS TURN confirms (and cite it), or say you will verify and then stop. ` +
    `Do not repeat an unbacked claim, and do not reference tools that are not registered in your scope.`;
}

/** User/Tyson-facing escalation text (the raw unbacked claim is never shown). */
export function buildEscalation(gateOut) {
  const lines = [];
  for (const g of (gateOut.gates || [])) {
    if (g.fired) for (const c of (g.claims || [])) lines.push(`• ${c.text || c} [${g.gate}]`);
  }
  return `⚠️ I couldn't verify the following before stating it, so I've stopped rather than risk an unbacked claim:\n` +
    `${lines.join('\n')}\nI need to actually run the check. Flagging this for you — say the word and I'll probe and report back with evidence.`;
}

/**
 * Run `generate(messages)` and gate its output; on failure regenerate up to
 * `maxAttempts` times, then escalate. soft_fail → deterministic hedge + re-check
 * (no LLM); hard_fail → re-prompt with structured feedback (an attempt).
 * The raw failing response is NEVER returned — only a hedged/corrected/escalated
 * one. Branches on gateOut.result (NOT action literals). Caller keeps tools
 * registered for the whole call (cleanupTools fires once after this returns).
 */
export async function regenerateWithGates({ generate, auditLog, toolRegistry, turnStart, agentScope = null, baseMessages, maxAttempts = 3, onGateLog = null, onEscalate = null, now = null }) {
  const opts = () => ({ now: now || Date.now(), turnStart, agentScope });
  let messages = baseMessages;
  let result = await generate(messages);
  let attempt = 1;
  let gateOut = runGates(result.content, auditLog, toolRegistry, opts());
  while (gateOut.result !== 'pass') {
    if (onGateLog) { try { onGateLog(gateOut, attempt); } catch { /* logging best-effort */ } }
    if (gateOut.result === 'soft_fail') {
      result = { ...result, content: hedgeResponse(result.content, gateOut) };
      gateOut = runGates(result.content, auditLog, toolRegistry, opts());
      if (gateOut.result === 'pass') break;
    }
    if (attempt >= maxAttempts) {
      if (onEscalate) { try { onEscalate(gateOut, attempt); } catch { /* best-effort */ } }
      result = { ...result, content: buildEscalation(gateOut), gateEscalated: true };
      break;
    }
    messages = [...baseMessages, { role: 'user', content: buildRepromptNote(gateOut) }];
    result = await generate(messages);
    attempt++;
    gateOut = runGates(result.content, auditLog, toolRegistry, opts());
  }
  return { ...result, gateAttempts: attempt, gateOutcome: gateOut.result };
}

export const __testing = { GATES };
