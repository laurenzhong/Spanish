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
  /** Whether a later attempt could plausibly succeed unchanged. */
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
}>;

/**
 * Sink for the observations above. An implementation must not throw, and the
 * adapter guards it anyway: telemetry must never turn a usable verdict into a
 * failure, and must never turn a failure into a verdict.
 */
export type LexiconReviewObserver = (observation: LexiconReviewObservation) => void;

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
