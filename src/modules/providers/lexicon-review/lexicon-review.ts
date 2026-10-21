/**
 * Lexicon candidate review: error codes, telemetry shape and input guards.
 *
 * This module is the *server-independent* half of the MiniMax candidate
 * reviewer. `candidate-reviewer.ts` in `lexicon-corpus/application` defines the
 * `CandidateReviewer` seam; this side owns the transport-level vocabulary for
 * its one real implementation:
 *
 * - the coded error the pipeline turns into `INDEXING_REVIEW_FAILED`;
 * - the observation record (provider / model / latency / request id) that
 *   AGENTS.md §7 requires;
 * - the pre-flight guard that refuses an unusable request *before* a paid call.
 *
 * Nothing here imports `server-only`, so this half is safe to import from tests
 * and from the fake that sits next to it.
 *
 * ## Fail-closed, stated once
 *
 * A review `pass` is a step towards owner approval and corpus indexing. Every
 * other outcome in this module — a truncated response, a schema mismatch, a
 * timeout, a cancellation, a 5xx, a missing key — is representable *only* as a
 * thrown `MiniMaxLexiconReviewError`. There is deliberately no union arm, no
 * `null` decision and no "assume pass" default: a caller cannot accidentally
 * read an approval out of a failure, because a failure is never a value.
 */

/**
 * Coded failures. The names line up with `LexiconExtractionError` so an
 * operator reading two provider logs sees one vocabulary, and
 * `provider-cancelled` in particular is what the indexing pipeline treats as a
 * cancellation rather than as a run failure.
 *
 * `provider-response-truncated` exists because `stop_reason: "max_tokens"` is
 * its own operational story: the fix is a bigger budget, not a different model
 * or a different prompt. It previously surfaced as a generic format error,
 * which sent debugging in the wrong direction.
 */
export const lexiconReviewErrorCodes = [
  "input-invalid",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
  "provider-response-truncated",
] as const;

export type LexiconReviewErrorCode = (typeof lexiconReviewErrorCodes)[number];

export class MiniMaxLexiconReviewError extends Error {
  readonly code: LexiconReviewErrorCode;
  /**
   * Whether the adapter's retry policy may spend another paid call on this
   * failure. This is the field the retry loop reads — one authority, so a code
   * cannot be retryable in one place and not in another.
   *
   * It is finer-grained than the code, deliberately. `provider-response-invalid`
   * covers two different situations that share a code: the model returned a
   * payload the strict schema refuses (worth one more call — the request was
   * fine), and the vendor rejected the request itself with a 4xx (a repeat call
   * fails identically and only burns quota). The code alone cannot tell them
   * apart, so the failing call site sets this flag.
   */
  readonly retryable: boolean;

  constructor(code: LexiconReviewErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "MiniMaxLexiconReviewError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** The provider key recorded on every observation. `minimax` is the only real one. */
export type LexiconReviewProviderKey = "minimax";

/**
 * One call's telemetry. Deliberately excludes the prompt, the raw response and
 * the API key (AGENTS.md §11): a review observation is a cost/latency record,
 * not a transcript of content that may later be re-versioned or withdrawn.
 */
export type LexiconReviewObservation = Readonly<{
  provider: LexiconReviewProviderKey;
  modelVersion: string;
  /** Which dimension was asked. One call answers exactly one dimension. */
  dimension: string;
  /** Provider-reported request id, when the response carries one. */
  providerRequestId: string | null;
  latencyMs: number;
  /** `null` when unknown; the Anthropic-compatible endpoint does not bill per response. */
  estimatedCostMicros: number | null;
  /** Why the call produced no usable verdict, or `null` on success. */
  failureCode: LexiconReviewErrorCode | null;
  /** The shape of a non-success: provider truncation is the one that matters. */
  stopReason: string | null;
  /**
   * HTTP attempts this observation covers, including the one that succeeded.
   * `1` is the normal case; higher means the retry policy was exercised, and the
   * count is what makes the extra spend visible to a canary (AGENTS.md §7).
   */
  attempts: number;
  /**
   * What each earlier attempt failed with, in order, so a canary can tell "the
   * model drifted once" from "the model is failing every time". Empty when
   * nothing was retried. Codes only — never the vendor's text.
   */
  attemptFailures: readonly LexiconReviewErrorCode[];
}>;

/**
 * Sink for the observations above. An implementation must not throw, and the
 * adapter guards it anyway: telemetry must never turn a usable verdict into a
 * failure, and must never turn a failure into a verdict.
 */
export type LexiconReviewObserver = (observation: LexiconReviewObservation) => void;

/** Resolves after `ms`; used between attempts. Injectable so tests never wait. */
export type LexiconReviewSleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/**
 * Delay before the next attempt, in milliseconds, given how many attempts have
 * already failed. Return `0` to retry immediately. Injectable so a test can pin
 * the sequence instead of measuring wall time.
 */
export type LexiconReviewBackoff = (failedAttempts: number) => number;

/**
 * Something that happened between attempts, reported so the decision is never
 * silent about the calls it cost.
 */
export type LexiconReviewRetryEvent = Readonly<{
  /** The attempt that just failed. */
  attempt: number;
  code: LexiconReviewErrorCode;
  /** Delay about to be awaited. */
  delayMs: number;
  /** Attempts still available. */
  attemptsRemaining: number;
}>;

/**
 * Decide how to wait before the next attempt.
 *
 * Returning `null` declines the retry — the failure is then rethrown unchanged.
 * The code-owned default only retries the codes in `lexiconReviewRetryableCodes`;
 * a hook that wants to decline one of those (a cheap canary, a hard deadline)
 * can say so without touching the parse rules.
 */
export type LexiconReviewRetryHook = (event: LexiconReviewRetryEvent) => number | null;

/**
 * The categories of failure a repeated call can plausibly fix, written down so a
 * reader can see the whole policy in one place.
 *
 * The retry loop itself reads `MiniMaxLexiconReviewError.retryable` (see below),
 * because two entries here share one code and only the call site knows which one
 * happened:
 *
 * - `provider-response-invalid` is retryable when the **model** produced a
 *   payload the strict schema refuses — the observed production flake, pure
 *   non-determinism, and a repeat usually comes back clean. It is *not*
 *   retryable when the **vendor** refused the request with a 4xx: the same
 *   request will be refused the same way, and retrying only spends quota.
 * - `provider-response-truncated` is retried with a larger completion budget
 *   (`truncatedMaxTokens`), because re-asking with the same budget truncates
 *   identically.
 * - `provider-timeout` and `provider-unavailable` (5xx) are transient by
 *   definition.
 *
 * Everything else is refused a second call, each for its own reason:
 * `provider-auth-failed` (401/403 — the key is wrong for this host, and a repeat
 * is a guaranteed repeat), `input-invalid` (the adapter refused before reaching
 * the network, so there is nothing to retry), `provider-cancelled` (the caller
 * asked to stop, and retrying would ignore that), `provider-rate-limited`
 * (the vendor asked us to slow down; an immediate in-call retry makes it worse —
 * pausing is the calling pipeline's decision, not this adapter's).
 */
export const lexiconReviewRetryableCodes = [
  "provider-response-invalid",
  "provider-response-truncated",
  "provider-timeout",
  "provider-unavailable",
] as const;

/**
 * Whether a code *can* be retryable. Being in this list is necessary but not
 * sufficient: consult the error's `retryable` flag for the decision, since a
 * code can carry both a retryable and a non-retryable situation.
 */
export function isRetryableLexiconReviewCode(code: LexiconReviewErrorCode): boolean {
  return (lexiconReviewRetryableCodes as readonly LexiconReviewErrorCode[]).includes(code);
}

/**
 * The default sleep.
 *
 * It listens for cancellation so a backoff cannot delay a stop the caller already
 * requested: when the signal aborts, the wait ends immediately and the caller
 * gets `provider-cancelled` rather than a verdict — or a bill — it no longer
 * wants. The timer is always cleared, so an aborted wait leaves nothing behind.
 */
export function createSleep(): LexiconReviewSleep {
  return (ms, signal) =>
    new Promise<void>((resolve) => {
      if (!signal || signal.aborted) {
        resolve();
        return;
      }
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, Math.max(0, ms));
      signal.addEventListener("abort", finish, { once: true });
    });
}

/**
 * The default delay policy: linear, jittered, capped.
 *
 * Linear rather than exponential because the budget is two extra attempts at
 * most — an exponential curve would either be pointless at this depth or push
 * the wait past the wall-clock budget. The jitter matters more than the growth:
 * it stops two dimensions of the same candidate from retrying in lockstep after
 * a shared hiccup. `Math.random()` is seeded nowhere on purpose — a production
 * retry should not be deterministic with respect to a flaky vendor.
 */
export function createLinearBackoff(
  baseMs: number,
  options: Readonly<{ jitterRatio?: number; maxMs?: number; random?: () => number }> = {},
): LexiconReviewBackoff {
  const jitterRatio = options.jitterRatio ?? 0.25;
  const maxMs = options.maxMs ?? 10_000;
  const random = options.random ?? Math.random;
  return (failedAttempts) => {
    const base = Math.max(0, baseMs) * Math.max(1, failedAttempts);
    const jitter = base * jitterRatio * (random() * 2 - 1);
    return Math.min(maxMs, Math.max(0, Math.round(base + jitter)));
  };
}

/**
 * What a dimension-specific review prompt needs from the candidate.
 *
 * The snapshot is *frozen*: `documentStableKey` / `documentVersion` /
 * `segmentIndex` pin the judgement to the exact published text that was
 * extracted, so a later content edit cannot move an approval onto new text.
 * `surfaceText` is what the reviewer validates against that context.
 */
export type LexiconReviewSnapshot = Readonly<{
  candidateId: string;
  kind: "lexeme" | "phrase";
  dimension: "content-es-ES" | "teaching-zh-CN";
  surfaceText: string;
  normalizedText: string;
  lemma: string | null;
  partOfSpeech: string | null;
  meaningZh: string | null;
  documentKind: "article" | "media";
  documentStableKey: string;
  documentVersion: number;
  segmentIndex: number;
  contextBefore: string;
  contextAfter: string;
}>;

/**
 * Reject an unusable request before spending money on it.
 *
 * Fail-closed on the way in: a snapshot without the exact published text would
 * ask the model to judge a form against context it cannot see, and a "pass" from
 * that call would be evidence of nothing.
 */
export function validateLexiconReviewSnapshot(snapshot: LexiconReviewSnapshot): void {
  if (!snapshot.candidateId.trim()) {
    throw new MiniMaxLexiconReviewError("input-invalid", "Review candidate id is empty.", false);
  }
  if (snapshot.kind !== "lexeme" && snapshot.kind !== "phrase") {
    throw new MiniMaxLexiconReviewError("input-invalid", "Review candidate kind is unsupported.", false);
  }
  if (!snapshot.surfaceText.trim() || !snapshot.normalizedText.trim()) {
    throw new MiniMaxLexiconReviewError("input-invalid", "Review candidate has no surface form.", false);
  }
  if (!snapshot.documentStableKey.trim()) {
    throw new MiniMaxLexiconReviewError("input-invalid", "Review candidate has no document key.", false);
  }
  if (!Number.isInteger(snapshot.documentVersion) || snapshot.documentVersion < 1) {
    throw new MiniMaxLexiconReviewError("input-invalid", "Review candidate document version is invalid.", false);
  }
  if (!Number.isInteger(snapshot.segmentIndex) || snapshot.segmentIndex < 0) {
    throw new MiniMaxLexiconReviewError("input-invalid", "Review candidate segment index is invalid.", false);
  }
  if (!snapshot.contextBefore.trim() && !snapshot.contextAfter.trim()) {
    // Without any surrounding text the model can only pattern-match the form
    // itself. Refusing is the honest answer; a verdict here would be a guess.
    throw new MiniMaxLexiconReviewError("input-invalid", "Review candidate has no frozen context to judge.", false);
  }
}
