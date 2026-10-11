/**
 * The `reviews` jsonb codec, shared by every store that carries a review record.
 *
 * ## Why this file exists
 *
 * Three places used to encode and decode the same jsonb shape independently:
 * `drizzle-lexicon-candidate-repository.ts`, `drizzle-lexicon-candidate-approval-audit-store.ts`
 * and the in-memory repository's clone. They happened to agree, but nothing kept
 * them agreeing, and a review record is audit evidence: a store that encodes a
 * field its reader drops (or vice versa) silently changes what the evidence says
 * without failing anything. One codec, used by all of them, removes that class of
 * bug rather than testing for it.
 *
 * ## Forward and backward compatibility
 *
 * `reviews` has been jsonb since migration 0042, so no migration is involved
 * here. Rows written before the reason field was added contain exactly four keys
 * — `dimension`, `outcome`, `reviewerReference`, `reviewedAt` — and **must still
 * decode**. The rule enforced below is therefore:
 *
 * - the four decision fields are required and strictly validated, exactly as
 *   before: a row whose *verdict* is unreadable is an error, because these rows
 *   are what proves dual review before approval;
 * - `reason` is optional and decoded permissively. A missing key, a null, a
 *   number, an object — all decode to "no reason", never to an error. Losing an
 *   explanation is acceptable; losing the verdict is not.
 *
 * ## The reason is never read here for anything but storage
 *
 * `decodeReviews` copies `reason` through; it does not consult it, compare it to
 * `outcome`, or branch on it. Nothing in the write path does either. That is the
 * mechanical form of the rule in `lexicon-review-reason.ts`.
 */

import type { LexiconCandidateReview } from "../domain/lexicon-candidate";
import { normalizeReviewReason } from "../domain/lexicon-review-reason";

/** A row as it arrives from jsonb: arbitrary keys, arbitrary values. */
export type StoredReviewEntry = Readonly<Record<string, unknown>>;

/** The jsonb shape written back to Postgres. */
export type EncodedReviewEntry = Readonly<{
  dimension: string;
  outcome: string;
  reviewerReference: string;
  reviewedAt: string;
  reason?: string;
}>;

/**
 * Build the store-specific decode error.
 *
 * The two stores keep separate error classes on purpose — a caller catching a
 * candidate-row failure should not also be catching approval failures — so the
 * codec is handed the factory instead of importing both.
 */
export type ReviewDecodeErrorFactory = (detail: string) => Error;

/**
 * Encode reviews for storage.
 *
 * `reviewedAt` becomes an ISO string because jsonb has no date type; `decode`
 * turns it back into a `Date`. `reason` is written only when it survives
 * normalisation, so a row that has no explanation has the historical four-key
 * shape rather than `"reason": null`. That keeps old and new rows structurally
 * comparable, which is what makes the compatibility test meaningful.
 */
export function encodeReviews(reviews: readonly LexiconCandidateReview[]): EncodedReviewEntry[] {
  return reviews.map((review) => {
    const reason = normalizeReviewReason(review.reason);
    const encoded: EncodedReviewEntry = {
      dimension: review.dimension,
      outcome: review.outcome,
      reviewerReference: review.reviewerReference,
      reviewedAt: review.reviewedAt.toISOString(),
    };
    return reason === null ? encoded : { ...encoded, reason };
  });
}

/**
 * Decode reviews read from jsonb.
 *
 * A malformed *decision* is an error, not something to skip: silently dropping a
 * review would reinterpret the evidence an approval was based on. A malformed
 * *reason* is dropped instead, and never reaches the caller as a failure.
 */
export function decodeReviews(
  entries: readonly StoredReviewEntry[],
  makeError: ReviewDecodeErrorFactory,
): readonly LexiconCandidateReview[] {
  return entries.map((entry, index) => {
    const dimension = entry.dimension;
    const outcome = entry.outcome;
    const reviewerReference = entry.reviewerReference;
    const reviewedAt = entry.reviewedAt;
    if (dimension !== "content-es-ES" && dimension !== "teaching-zh-CN") {
      throw makeError(`review ${index} has an unknown dimension`);
    }
    if (outcome !== "pass" && outcome !== "fail") {
      throw makeError(`review ${index} has an unknown outcome`);
    }
    if (typeof reviewerReference !== "string" || reviewerReference.length === 0) {
      throw makeError(`review ${index} has no reviewer reference`);
    }
    const reviewedAtDate = typeof reviewedAt === "string" || reviewedAt instanceof Date ? new Date(reviewedAt) : null;
    if (!reviewedAtDate || Number.isNaN(reviewedAtDate.getTime())) {
      throw makeError(`review ${index} has no usable reviewedAt`);
    }

    // Only a present, usable reason is attached. `hasOwnProperty` rather than a
    // truthiness test, so a row that deliberately stores an empty string is
    // still read as "no reason" instead of as a value that then needs trimming.
    const storedReason = Object.prototype.hasOwnProperty.call(entry, "reason")
      ? normalizeReviewReason(entry.reason)
      : null;
    const review: LexiconCandidateReview = {
      dimension,
      // The stored outcome is the verdict, full stop. `reason` plays no part.
      outcome,
      reviewerReference,
      reviewedAt: reviewedAtDate,
    };
    return storedReason === null ? review : { ...review, reason: storedReason };
  });
}

/** The four decision fields as a row written by a pre-reason build. */
export function legacyReviewEntry(review: LexiconCandidateReview): StoredReviewEntry {
  return {
    dimension: review.dimension,
    outcome: review.outcome,
    reviewerReference: review.reviewerReference,
    reviewedAt: review.reviewedAt.toISOString(),
  };
}
