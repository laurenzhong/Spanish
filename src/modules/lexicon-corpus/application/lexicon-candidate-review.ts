/**
 * Lexicon candidate review orchestration (LEX-INDEX-001 slice 4).
 *
 * This module is the only place where the candidate state machine is joined to
 * the owner-authorized review identity. It is deliberately pure:
 *
 * - it never receives a repository, so recording a review can never write a
 *   corpus row and can never publish anything. Indexing is a *separate* step
 *   that only an approved candidate may reach (see `approve-candidate-indexing`);
 * - it validates the reviewer through the existing
 *   `isOwnerAuthorizedReviewerReference()` — the same authority the content
 *   publication gate uses. A second, local identity check would drift from it;
 * - it reviews a *frozen* candidate: document, version and segment index are
 *   part of the extraction-time snapshot, so a later content edit cannot
 *   silently move an approved candidate onto different text.
 */

import { isOwnerAuthorizedReviewerReference } from "@/src/modules/content-acquisition/domain/review-identity";

import { normalizeReviewReason } from "../domain/lexicon-review-reason";
import {
  approveCandidate,
  lexiconReviewDimensionValues,
  recordReview,
  submitForReview,
  type LexiconCandidate,
  type LexiconCandidateConflict,
  type LexiconCandidateReview,
  type LexiconReviewDimension,
  type LexiconReviewOutcome,
} from "../domain/lexicon-candidate";

/**
 * Failures this layer can produce on top of the domain conflicts.
 *
 * Every code is reachable from the functions below — a code that cannot happen
 * would invite callers to handle a case that does not exist.
 */
export type LexiconCandidateReviewFailureCode =
  /** The reviewer/approver reference failed the shared owner-authorized check. */
  | "CANDIDATE_REVIEWER_NOT_AUTHORIZED"
  /** The review record is missing a usable `reviewedAt`. */
  | "CANDIDATE_REVIEW_RECORD_INCOMPLETE"
  /** Approval was attempted without both review dimensions on record. */
  | "CANDIDATE_REVIEW_INCOMPLETE"
  /** The candidate does not carry a complete frozen source snapshot. */
  | "CANDIDATE_SOURCE_NOT_FROZEN"
  | LexiconCandidateConflict;

export type LexiconCandidateReviewResult =
  | Readonly<{ ok: true; candidate: LexiconCandidate }>
  | Readonly<{ ok: false; code: LexiconCandidateReviewFailureCode }>;

type DomainTransitionResult =
  | Readonly<{ ok: true; candidate: LexiconCandidate }>
  | Readonly<{ ok: false; conflict: LexiconCandidateConflict }>;

function fail(code: LexiconCandidateReviewFailureCode): LexiconCandidateReviewResult {
  return { ok: false, code };
}

/** Adapt a domain transition result without swallowing its conflict code. */
function fromDomain(result: DomainTransitionResult): LexiconCandidateReviewResult {
  return result.ok ? { ok: true, candidate: result.candidate } : fail(result.conflict);
}

function isUsableDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Whether the candidate carries the provenance that was frozen at extraction.
 *
 * A candidate without it cannot be attributed to a published document version,
 * so reviewing (and later indexing) it would create a corpus occurrence that no
 * source can be held responsible for.
 */
export function candidateHasFrozenSource(candidate: LexiconCandidate): boolean {
  const { source } = candidate;
  return (
    source.documentStableKey.trim().length > 0
    && Number.isInteger(source.documentVersion)
    && source.documentVersion >= 1
    && Number.isInteger(source.segmentIndex)
    && source.segmentIndex >= 0
    && source.sourceTitle.trim().length > 0
    && source.sourceKind.trim().length > 0
  );
}

/**
 * Whether both review dimensions passed.
 *
 * The state machine already encodes this: `review_ready` is reachable only from
 * `recordReview()` when both dimensions passed. This helper is the *data* check
 * used by the approval gate, so a candidate whose status claims `review_ready`
 * while its review rows are incomplete cannot be approved or batch-approved.
 */
export function candidateHasBothReviewDimensions(candidate: LexiconCandidate): boolean {
  return lexiconReviewDimensionValues.every((dimension) =>
    candidate.reviews.some((review) => review.dimension === dimension && review.outcome === "pass"),
  );
}

/**
 * Send a discovered candidate for review. Idempotent for the same revision;
 * a stale caller gets a revision conflict instead of silently mutating state.
 */
export function submitCandidateForReview(
  candidate: LexiconCandidate,
  input: Readonly<{ expectedRevision: number; now: Date }>,
): LexiconCandidateReviewResult {
  if (!candidateHasFrozenSource(candidate)) return fail("CANDIDATE_SOURCE_NOT_FROZEN");
  return fromDomain(submitForReview(candidate, input));
}

/**
 * Record one review dimension against the frozen candidate.
 *
 * Both `content-es-ES` and `teaching-zh-CN` must pass before the candidate
 * becomes `review_ready`, so a single dimension can never unlock approval. A
 * failing dimension settles the candidate as `rejected` in the same call.
 */
export function recordCandidateReview(
  candidate: LexiconCandidate,
  input: Readonly<{
    dimension: LexiconReviewDimension;
    outcome: LexiconReviewOutcome;
    reviewerReference: string;
    reviewedAt: Date;
    /**
     * The reviewer's explanation, recorded **for diagnosis only**.
     *
     * It is normalised (trimmed, capped, truncated) and attached to the stored
     * review; it is never read back by this function and cannot influence the
     * verdict or the resulting status. Only `outcome` decides whether the
     * candidate settles as `rejected`. An over-long or malformed explanation is
     * dropped, never a reason to refuse the review.
     */
    reason?: unknown;
    expectedRevision: number;
    now: Date;
  }>,
): LexiconCandidateReviewResult {
  if (!candidateHasFrozenSource(candidate)) return fail("CANDIDATE_SOURCE_NOT_FROZEN");
  if (!isOwnerAuthorizedReviewerReference(input.reviewerReference)) {
    return fail("CANDIDATE_REVIEWER_NOT_AUTHORIZED");
  }
  if (!isUsableDate(input.reviewedAt) || !isUsableDate(input.now)) {
    return fail("CANDIDATE_REVIEW_RECORD_INCOMPLETE");
  }

  const reason = normalizeReviewReason(input.reason);
  const review: LexiconCandidateReview = {
    dimension: input.dimension,
    // Verbatim: the input outcome is the only authority here. Nothing below
    // inspects `reason`, and the field is deliberately written after this line so
    // a future edit is forced past the comment.
    outcome: input.outcome,
    reviewerReference: input.reviewerReference,
    reviewedAt: input.reviewedAt,
    ...(reason === null ? {} : { reason }),
  };
  return fromDomain(recordReview(candidate, { review, expectedRevision: input.expectedRevision, now: input.now }));
}

/**
 * Owner approval, kept pure and separate from the corpus write.
 *
 * The approver goes through the same owner-authorized identity check as the
 * reviewers: approving is an owner act, so an arbitrary string must never
 * become `approvedBy` provenance. The state machine decides legal and stale
 * transitions first; the dual-dimension check then re-reads the review rows so
 * the approval gate does not rely on `status` alone.
 */
export function approveCandidateForIndexing(
  candidate: LexiconCandidate,
  input: Readonly<{ approvedBy: string; expectedRevision: number; now: Date }>,
): LexiconCandidateReviewResult {
  // Approval is the last state before a corpus write, so the frozen provenance
  // must still be intact here as well.
  if (!candidateHasFrozenSource(candidate)) return fail("CANDIDATE_SOURCE_NOT_FROZEN");
  if (!isOwnerAuthorizedReviewerReference(input.approvedBy)) {
    return fail("CANDIDATE_REVIEWER_NOT_AUTHORIZED");
  }
  if (!isUsableDate(input.now)) return fail("CANDIDATE_REVIEW_RECORD_INCOMPLETE");

  const approved = fromDomain(approveCandidate(candidate, input));
  if (!approved.ok) return approved;
  if (!candidateHasBothReviewDimensions(approved.candidate)) return fail("CANDIDATE_REVIEW_INCOMPLETE");
  return approved;
}
