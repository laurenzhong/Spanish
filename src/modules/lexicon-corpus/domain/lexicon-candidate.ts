/**
 * Lexicon indexing candidates.
 *
 * A candidate is a *proposal* that a surface form in published content should
 * become a `lexeme` or a `phrase_entry`. Candidates deliberately live outside
 * the corpus tables: nothing here may create a `lexeme`, a `phrase_entry` or a
 * `corpus_occurrence`. Only an approved candidate is handed to
 * `indexContentVersion()`, and that call happens in the application layer.
 *
 * Invariants enforced here (see ADR-0011):
 * - automatic extraction can never reach `approved` by itself;
 * - a rejection is terminal — a re-extraction produces a new candidate revision;
 * - `lemmaStatus` stays `pending` until approval, so the shelf never presents an
 *   unapproved surface form as a confirmed lexeme.
 */

export const lexiconCandidateKindSchemaValues = ["lexeme", "phrase"] as const;
export type LexiconCandidateKind = (typeof lexiconCandidateKindSchemaValues)[number];

/**
 * `discovered`      — extracted, not yet sent for review.
 * `review_submitted`— both review dimensions requested.
 * `review_ready`    — both dimensions recorded; awaiting a human decision.
 * `approved`        — may be indexed.
 * `rejected`        — terminal; never indexed.
 */
export const lexiconCandidateStatusValues = [
  "discovered",
  "review_submitted",
  "review_ready",
  "approved",
  "rejected",
] as const;
export type LexiconCandidateStatus = (typeof lexiconCandidateStatusValues)[number];

/** The two review dimensions required before a decision. Mirrors content review. */
export const lexiconReviewDimensionValues = ["content-es-ES", "teaching-zh-CN"] as const;
export type LexiconReviewDimension = (typeof lexiconReviewDimensionValues)[number];

export const lexiconReviewOutcomeValues = ["pass", "fail"] as const;
export type LexiconReviewOutcome = (typeof lexiconReviewOutcomeValues)[number];

/**
 * Stable, transport-safe failure codes. Callers map these to HTTP/protocol
 * errors. Every code here is reachable from these pure functions — an
 * unreachable code would invite callers to handle a case that cannot occur.
 *
 * "not found" is deliberately absent: it is a persistence concern, and these
 * functions only ever receive a candidate that was already loaded.
 */
export type LexiconCandidateConflict =
  | "CANDIDATE_REVISION_CONFLICT"
  | "CANDIDATE_INVALID_TRANSITION"
  | "CANDIDATE_REVIEW_ALREADY_RECORDED"
  | "CANDIDATE_REJECTED_IS_TERMINAL";

export type LexiconCandidateReview = Readonly<{
  dimension: LexiconReviewDimension;
  outcome: LexiconReviewOutcome;
  /** Must be a recognised review identity; the application layer validates it. */
  reviewerReference: string;
  reviewedAt: Date;
}>;

/**
 * Where the candidate came from. Frozen at extraction time so a later content
 * edit cannot silently move an approved candidate to different text.
 */
export type LexiconCandidateSource = Readonly<{
  documentKind: "article" | "media";
  documentStableKey: string;
  documentVersion: number;
  segmentIndex: number;
  contextBefore: string;
  contextAfter: string;
  sourceTitle: string;
  sourceKind: string;
}>;

export type LexiconCandidate = Readonly<{
  id: string;
  kind: LexiconCandidateKind;
  /** Surface form exactly as it appeared in the segment. */
  surfaceText: string;
  normalizedText: string;
  /** Lexeme-only: the lemma the surface form belongs to. */
  lemma: string | null;
  /** Lexeme-only: part of speech from the controlled set, or null when unknown. */
  partOfSpeech: string | null;
  /** Phrase-only: the learner-facing translation. */
  meaningZh: string | null;
  status: LexiconCandidateStatus;
  /** Monotonic; every accepted transition increments it (CAS precondition). */
  revision: number;
  source: LexiconCandidateSource;
  reviews: readonly LexiconCandidateReview[];
  /** Set only on approval. Echoed into the corpus row so provenance survives. */
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

/**
 * A lexeme candidate is not a confirmed lexeme. `lemmaStatus` is derived, not
 * stored per row, so the corpus can never accidentally receive `verified`.
 */
export function candidateLemmaStatus(candidate: LexiconCandidate): "verified" | "pending" {
  return candidate.status === "approved" ? "verified" : "pending";
}

/** The only statuses that may be handed to `indexContentVersion()`. */
export function isIndexable(candidate: LexiconCandidate): boolean {
  return candidate.status === "approved";
}

export function makeCandidateId(input: Readonly<{ kind: LexiconCandidateKind; stableKey: string; version: number; segmentIndex: number; normalizedText: string }>): string {
  return [input.kind, input.stableKey, String(input.version), String(input.segmentIndex), input.normalizedText].join("|");
}

type TransitionResult =
  | Readonly<{ ok: true; candidate: LexiconCandidate }>
  | Readonly<{ ok: false; conflict: LexiconCandidateConflict }>;

function fail(conflict: LexiconCandidateConflict): TransitionResult {
  return { ok: false, conflict };
}

/** Legal edges. Anything absent is illegal, including every edge out of `rejected`. */
const legalTransitions: Readonly<Record<LexiconCandidateStatus, readonly LexiconCandidateStatus[]>> = {
  discovered: ["review_submitted", "rejected"],
  review_submitted: ["review_ready", "rejected"],
  review_ready: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function canTransition(from: LexiconCandidateStatus, to: LexiconCandidateStatus): boolean {
  return legalTransitions[from].includes(to);
}

/**
 * Send a discovered candidate for review. Idempotent for the same revision;
 * a stale caller gets a revision conflict rather than silently mutating state.
 */
export function submitForReview(
  candidate: LexiconCandidate,
  input: Readonly<{ expectedRevision: number; now: Date }>,
): TransitionResult {
  if (input.expectedRevision !== candidate.revision) return fail("CANDIDATE_REVISION_CONFLICT");
  if (candidate.status === "review_submitted") return { ok: true, candidate };
  if (!canTransition(candidate.status, "review_submitted")) return fail("CANDIDATE_INVALID_TRANSITION");
  return {
    ok: true,
    candidate: { ...candidate, status: "review_submitted", revision: candidate.revision + 1, updatedAt: input.now },
  };
}

/**
 * Record one review dimension. Both dimensions must pass before `review_ready`,
 * so a single dimension can never unlock approval.
 */
export function recordReview(
  candidate: LexiconCandidate,
  input: Readonly<{ review: LexiconCandidateReview; expectedRevision: number; now: Date }>,
): TransitionResult {
  if (input.expectedRevision !== candidate.revision) return fail("CANDIDATE_REVISION_CONFLICT");
  if (candidate.status !== "review_submitted") return fail("CANDIDATE_INVALID_TRANSITION");
  if (candidate.reviews.some((review) => review.dimension === input.review.dimension)) {
    return fail("CANDIDATE_REVIEW_ALREADY_RECORDED");
  }

  const reviews = [...candidate.reviews, input.review];
  const failed = reviews.some((review) => review.outcome === "fail");

  // A failing dimension settles the candidate immediately: it can never be
  // approved, so we do not wait for the second dimension.
  if (failed) {
    return {
      ok: true,
      candidate: {
        ...candidate,
        reviews,
        status: "rejected",
        rejectedReason: "REVIEW_DIMENSION_FAILED",
        revision: candidate.revision + 1,
        updatedAt: input.now,
      },
    };
  }

  const complete = lexiconReviewDimensionValues.every((dimension) =>
    reviews.some((review) => review.dimension === dimension && review.outcome === "pass"),
  );

  return {
    ok: true,
    candidate: {
      ...candidate,
      reviews,
      status: complete ? "review_ready" : "review_submitted",
      revision: candidate.revision + 1,
      updatedAt: input.now,
    },
  };
}

/**
 * Owner approval. This is the only path to `approved`.
 *
 * `review_ready` is reachable *only* when both dimensions passed (see
 * `recordReview`), so the structural guard below is what keeps unreviewed
 * candidates out: `review_submitted` cannot jump to `approved`. Keeping the
 * check single-sourced means the two functions can never disagree.
 */
export function approveCandidate(
  candidate: LexiconCandidate,
  input: Readonly<{ approvedBy: string; expectedRevision: number; now: Date }>,
): TransitionResult {
  if (input.expectedRevision !== candidate.revision) return fail("CANDIDATE_REVISION_CONFLICT");
  if (candidate.status === "rejected") return fail("CANDIDATE_REJECTED_IS_TERMINAL");
  if (candidate.status === "approved") return { ok: true, candidate };
  if (!canTransition(candidate.status, "approved")) return fail("CANDIDATE_INVALID_TRANSITION");

  return {
    ok: true,
    candidate: {
      ...candidate,
      status: "approved",
      approvedBy: input.approvedBy,
      approvedAt: input.now,
      revision: candidate.revision + 1,
      updatedAt: input.now,
    },
  };
}

/** Rejection is terminal; anything already approved or rejected is refused. */
export function rejectCandidate(
  candidate: LexiconCandidate,
  input: Readonly<{ reason: string; expectedRevision: number; now: Date }>,
): TransitionResult {
  if (input.expectedRevision !== candidate.revision) return fail("CANDIDATE_REVISION_CONFLICT");
  if (candidate.status === "rejected") return fail("CANDIDATE_REJECTED_IS_TERMINAL");
  if (!canTransition(candidate.status, "rejected")) return fail("CANDIDATE_INVALID_TRANSITION");
  return {
    ok: true,
    candidate: {
      ...candidate,
      status: "rejected",
      rejectedReason: input.reason,
      revision: candidate.revision + 1,
      updatedAt: input.now,
    },
  };
}
