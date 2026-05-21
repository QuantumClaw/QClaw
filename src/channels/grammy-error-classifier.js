/**
 * grammY runner error classifier (Slice 3e).
 *
 * Pure function: input (error from bot.api.getUpdates), output a classification
 * record describing whether to retry, how long to back off, and whether the
 * error is transient vs non-transient vs unknown.
 *
 * No side effects: no fs, no setTimeout, no global state. Caller is responsible
 * for sleeping, logging, and mutating channel registry.
 *
 * Classification table:
 *
 * | Input shape                                            | kind          | shouldRetry |
 * |--------------------------------------------------------|---------------|-------------|
 * | GrammyError, error_code in {429, 502, 503, 504}        | transient     | true        |
 * | GrammyError, error_code in {401, 403, 409}             | non_transient | false       |
 * | GrammyError, other error_code                          | non_transient | false       |
 * | Error with code in standard Node net error codes       | transient     | true        |
 * | Error with code in undici codes (forward-compat)       | transient     | true        |
 * | Error/object with neither error_code nor code          | unknown       | true        |
 * | null / undefined / non-object                          | unknown       | true        |
 *
 * 429 special case: if err.parameters.retry_after (seconds) is present, the
 * effective backoff is max(retry_after * 1000, base_for_attempt), capped at
 * 60000ms per attempt for sanity.
 *
 * Backoff schedule (attempt is 1-indexed):
 *   1: 1000ms  ± 25% jitter
 *   2: 2000ms  ± 25% jitter
 *   3: 4000ms  ± 25% jitter
 *   4: 8000ms  ± 25% jitter
 *   5: 16000ms ± 25% jitter
 *   6+: shouldRetry forced false (max attempts exhausted)
 */

const MAX_ATTEMPTS = 5;
const RETRY_AFTER_CAP_MS = 60_000;

const TRANSIENT_HTTP_STATUSES = new Set([429, 502, 503, 504]);
const NON_TRANSIENT_HTTP_STATUSES = new Set([401, 403, 409]);

// node-fetch FetchError surfaces these via err.code (standard Node net errors).
// grammY 1.40 + @grammyjs/runner 2.0.3 use node-fetch 2.7.x.
const TRANSIENT_NODE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ECONNREFUSED',
]);

// undici codes — forward-compat in case grammY's fetch backend changes.
const TRANSIENT_UNDICI_CODES = new Set([
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_DESTROYED',
]);

/**
 * Compute the base backoff (ms) for a 1-indexed attempt number.
 * Returns undefined if attempt exceeds MAX_ATTEMPTS.
 */
function baseBackoffMs(attempt) {
  if (attempt < 1 || attempt > MAX_ATTEMPTS) return undefined;
  return 1000 * 2 ** (attempt - 1);
}

/**
 * Apply ±25% jitter to a base backoff value.
 * Uses Math.random — sufficient for spreading retry timing across instances.
 *
 * Formula: jitter = baseMs * 0.25 * (2*random - 1)
 *   random=0   → jitter = baseMs * 0.25 * (-1) = -25% of base
 *   random=0.5 → jitter = baseMs * 0.25 * 0    = 0
 *   random=1   → jitter = baseMs * 0.25 * (+1) = +25% of base
 */
function applyJitter(baseMs, random = Math.random) {
  const jitter = baseMs * 0.25 * (2 * random() - 1);
  return Math.max(0, Math.round(baseMs + jitter));
}

/**
 * Classify an error from the grammY runner's update loop.
 *
 * @param {unknown} err - the error thrown by bot.api.getUpdates (via the runner)
 * @param {object} [opts]
 * @param {number} [opts.attempt=1] - 1-indexed current attempt number
 * @param {() => number} [opts.random=Math.random] - injectable for tests
 * @returns {{
 *   kind: 'transient' | 'non_transient' | 'unknown',
 *   httpStatus?: number,
 *   networkCode?: string,
 *   shouldRetry: boolean,
 *   backoffMs?: number,
 *   reason: string,
 * }}
 */
export function classify(err, opts = {}) {
  // Slice 3e fixup-3 (finding 3): same Number.isFinite hardening fixup-2 #9
  // applied to retry_after. Without this, attempt=NaN passes the
  // `attempt > MAX_ATTEMPTS` guard (NaN>5 is false → attemptsExhausted=false)
  // AND the `attempt < 1 || attempt > MAX_ATTEMPTS` guard inside
  // baseBackoffMs, producing baseBackoffMs(NaN) = 1000 * 2 ** NaN = NaN,
  // which propagates to backoffMs = NaN → setTimeout(_, NaN) → Node coerces
  // to 1ms (accelerated retry loop, same shape as the retry_after NaN bug).
  // Treat non-finite attempt the same as a missing attempt: fall back to 1.
  const attempt = Number.isFinite(opts.attempt) ? opts.attempt : 1;
  const random = opts.random ?? Math.random;

  // Attempt > MAX_ATTEMPTS — forced no-retry regardless of classification.
  const attemptsExhausted = attempt > MAX_ATTEMPTS;

  // null / undefined / non-object → unknown.
  if (err === null || err === undefined || typeof err !== 'object') {
    return {
      kind: 'unknown',
      shouldRetry: !attemptsExhausted,
      backoffMs: attemptsExhausted ? undefined : applyJitter(baseBackoffMs(attempt), random),
      reason: 'non_object_or_null',
    };
  }

  const errorCode = typeof err.error_code === 'number' ? err.error_code : undefined;
  const netCode = typeof err.code === 'string' ? err.code : undefined;

  // GrammyError with structured error_code → check transient set first.
  if (errorCode !== undefined) {
    if (TRANSIENT_HTTP_STATUSES.has(errorCode)) {
      // 429 special case: honour parameters.retry_after if present.
      let backoffMs = baseBackoffMs(attempt);
      if (errorCode === 429
          && err.parameters
          && typeof err.parameters === 'object'
          && Number.isFinite(err.parameters.retry_after)) {
        // Slice 3e fixup-2 (finding 9): Number.isFinite rejects NaN +
        // Infinity + -Infinity. Previous `typeof === 'number'` admitted
        // NaN, which propagated to backoffMs = NaN → setTimeout(_, NaN)
        // (Node coerces to 1ms — effectively no-op backoff, accelerated
        // retry loop) and to JSON.stringify(NaN) = null (degraded
        // observability). Negative retry_after is also non-sensical;
        // Math.max with baseBackoffMs ensures we never sleep less than
        // base regardless.
        const retryAfterMs = Math.min(err.parameters.retry_after * 1000, RETRY_AFTER_CAP_MS);
        backoffMs = Math.max(retryAfterMs, backoffMs);
      } else if (backoffMs !== undefined) {
        backoffMs = applyJitter(backoffMs, random);
      }
      return {
        kind: 'transient',
        httpStatus: errorCode,
        shouldRetry: !attemptsExhausted,
        backoffMs: attemptsExhausted ? undefined : backoffMs,
        reason: errorCode === 429 ? 'rate_limit' : 'gateway_or_unavailable',
      };
    }
    if (NON_TRANSIENT_HTTP_STATUSES.has(errorCode)) {
      return {
        kind: 'non_transient',
        httpStatus: errorCode,
        shouldRetry: false,
        reason: errorCode === 401 ? 'unauthorised'
          : errorCode === 403 ? 'forbidden'
          : 'conflict',
      };
    }
    // Any other error_code — treat as non-transient. Recovery timer can retry
    // every 5 min; if it's actually a transient masquerader, it recovers
    // within one tick. Fail-loud here is preferred over swallowing.
    return {
      kind: 'non_transient',
      httpStatus: errorCode,
      shouldRetry: false,
      reason: 'unclassified_http_status',
    };
  }

  // Network-level error (no Telegram error_code, just a Node fetch failure).
  if (netCode !== undefined) {
    if (TRANSIENT_NODE_CODES.has(netCode) || TRANSIENT_UNDICI_CODES.has(netCode)) {
      const backoffMs = attemptsExhausted ? undefined : applyJitter(baseBackoffMs(attempt), random);
      return {
        kind: 'transient',
        networkCode: netCode,
        shouldRetry: !attemptsExhausted,
        backoffMs,
        reason: 'network_error',
      };
    }
    // Unknown network code → still treat as unknown-transient (better to retry
    // a flaky network than crash on a code we haven't enumerated).
    return {
      kind: 'unknown',
      networkCode: netCode,
      shouldRetry: !attemptsExhausted,
      backoffMs: attemptsExhausted ? undefined : applyJitter(baseBackoffMs(attempt), random),
      reason: 'unknown_network_code',
    };
  }

  // Neither structured error_code nor recognisable network code. Could be a
  // bare TypeError, AggregateError, or string-message Error. Retry bounded.
  return {
    kind: 'unknown',
    shouldRetry: !attemptsExhausted,
    backoffMs: attemptsExhausted ? undefined : applyJitter(baseBackoffMs(attempt), random),
    reason: 'unstructured_error',
  };
}

export const _internal = {
  MAX_ATTEMPTS,
  RETRY_AFTER_CAP_MS,
  TRANSIENT_HTTP_STATUSES,
  NON_TRANSIENT_HTTP_STATUSES,
  TRANSIENT_NODE_CODES,
  TRANSIENT_UNDICI_CODES,
  baseBackoffMs,
  applyJitter,
};
