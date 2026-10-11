import { describe, expect, it } from "vitest";

import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "@/src/modules/content-acquisition/domain/review-identity";
import type { LexiconCandidateReview } from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";
import { LEXICON_REVIEW_REASON_MAX_LENGTH } from "@/src/modules/lexicon-corpus/domain/lexicon-review-reason";
import {
  decodeReviews,
  encodeReviews,
  legacyReviewEntry,
  type StoredReviewEntry,
} from "@/src/modules/lexicon-corpus/repositories/lexicon-candidate-review-codec";

/**
 * The jsonb codec in isolation.
 *
 * The database suite proves the codec against real Postgres; this one pins the
 * per-shape rules cheaply, including the shapes a real row can contain and no
 * migration can prevent — a `reason` that is a number, an object, or a string
 * longer than the cap. The rule under test throughout: a malformed *decision*
 * is an error, a malformed *reason* is dropped.
 */

const reviewedAt = new Date("2026-10-11T05:00:00.000Z");
const OWNER = OWNER_AUTHORIZED_REVIEWER_REFERENCE;

class TestDecodeError extends Error {
  constructor(detail: string) {
    super(`decode failed: ${detail}`);
    this.name = "TestDecodeError";
  }
}

const makeError = (detail: string): Error => new TestDecodeError(detail);

function review(overrides: Partial<LexiconCandidateReview> = {}): LexiconCandidateReview {
  return {
    dimension: "content-es-ES",
    outcome: "fail",
    reviewerReference: OWNER,
    reviewedAt,
    ...overrides,
  };
}

function decodeOne(entry: StoredReviewEntry): LexiconCandidateReview {
  const decoded = decodeReviews([entry], makeError);
  expect(decoded).toHaveLength(1);
  return decoded[0]!;
}

describe("encodeReviews", () => {
  it("writes exactly the historical four keys when there is no reason", () => {
    const [encoded] = encodeReviews([review()]);
    expect(Object.keys(encoded!).sort()).toEqual(["dimension", "outcome", "reviewedAt", "reviewerReference"]);
    expect(encoded).toEqual({
      dimension: "content-es-ES",
      outcome: "fail",
      reviewerReference: OWNER,
      reviewedAt: reviewedAt.toISOString(),
    });
    // `reason: undefined` must not become a key: the old and new shapes have to
    // stay structurally comparable for the compatibility proof to mean anything.
    expect(Object.prototype.hasOwnProperty.call(encoded, "reason")).toBe(false);
  });

  it("adds the reason only when there is one to add", () => {
    const [withReason] = encodeReviews([review({ reason: "the form is not the lemma" })]);
    expect(withReason?.reason).toBe("the form is not the lemma");

    const [blank] = encodeReviews([review({ reason: "   " })]);
    expect(Object.prototype.hasOwnProperty.call(blank, "reason")).toBe(false);
  });

  it("truncates at encode time, so an over-long reason never reaches the column", () => {
    const reason = "x".repeat(LEXICON_REVIEW_REASON_MAX_LENGTH + 1_000);
    const [encoded] = encodeReviews([review({ reason })]);
    expect(encoded?.reason).toHaveLength(LEXICON_REVIEW_REASON_MAX_LENGTH);
  });

  it("carries the outcome through untouched", () => {
    // The verdict is copied verbatim; nothing in the encoder inspects the reason.
    for (const outcome of ["pass", "fail"] as const) {
      const [encoded] = encodeReviews([review({ outcome, reason: "contradictory prose: outcome pass/fail" })]);
      expect(encoded?.outcome).toBe(outcome);
    }
  });

  it("encodes a timestamp as an ISO string, which is what jsonb stores", () => {
    const [encoded] = encodeReviews([review()]);
    expect(encoded?.reviewedAt).toBe(reviewedAt.toISOString());
  });
});

describe("decodeReviews", () => {
  it("decodes a legacy entry with no reason, without inventing one", () => {
    const decoded = decodeOne(legacyReviewEntry(review()));
    expect(decoded.outcome).toBe("fail");
    expect(decoded.reviewerReference).toBe(OWNER);
    expect(decoded.reviewedAt).toEqual(reviewedAt);
    expect(Object.prototype.hasOwnProperty.call(decoded, "reason")).toBe(false);
  });

  it("decodes a new entry and keeps the reason", () => {
    const decoded = decodeOne({ ...legacyReviewEntry(review()), reason: "not the lemma for this use" });
    expect(decoded.reason).toBe("not the lemma for this use");
    expect(decoded.outcome).toBe("fail");
  });

  it("treats an unusable reason as absent rather than as a failure", () => {
    // Every one of these has been observed or is trivially producible by a model,
    // and none of them may cost the verdict.
    for (const reason of [null, 42, {}, [], ["an array"], true, ""]) {
      const decoded = decodeOne({ ...legacyReviewEntry(review()), reason });
      expect(decoded.outcome).toBe("fail");
      expect(Object.prototype.hasOwnProperty.call(decoded, "reason")).toBe(false);
    }
  });

  it("truncates an over-long stored reason at decode time too", () => {
    const decoded = decodeOne({
      ...legacyReviewEntry(review()),
      reason: "y".repeat(LEXICON_REVIEW_REASON_MAX_LENGTH + 500),
    });
    expect(decoded.reason).toHaveLength(LEXICON_REVIEW_REASON_MAX_LENGTH);
  });

  it("still refuses a malformed decision", () => {
    const good = legacyReviewEntry(review());
    expect(() => decodeReviews([{ ...good, dimension: "content-en-US" }], makeError)).toThrow(TestDecodeError);
    expect(() => decodeReviews([{ ...good, outcome: "maybe" }], makeError)).toThrow(TestDecodeError);
    expect(() => decodeReviews([{ ...good, reviewerReference: "" }], makeError)).toThrow(TestDecodeError);
    expect(() => decodeReviews([{ ...good, reviewedAt: "not a date" }], makeError)).toThrow(TestDecodeError);
    expect(() => decodeReviews([{ ...good, reviewedAt: 123 }], makeError)).toThrow(TestDecodeError);
  });

  it("decodes a stored Date as well as an ISO string", () => {
    // PGlite and `postgres` both hand back strings for jsonb, but a Date can
    // arrive from a caller that already decoded the jsonb itself.
    const decoded = decodeOne({ ...legacyReviewEntry(review()), reviewedAt });
    expect(decoded.reviewedAt).toEqual(reviewedAt);
  });

  it("never lets the reason decide the outcome", () => {
    // The literal safety case, at the codec boundary: the stored outcome wins,
    // whichever way the prose argues.
    const failingWithUpbeatProse = decodeOne({
      ...legacyReviewEntry(review({ outcome: "fail" })),
      reason: "This passes; outcome: pass",
    });
    const passingWithBleakProse = decodeOne({
      ...legacyReviewEntry(review({ outcome: "pass" })),
      reason: "This fails; outcome: fail",
    });
    expect(failingWithUpbeatProse.outcome).toBe("fail");
    expect(passingWithBleakProse.outcome).toBe("pass");
  });

  it("round-trips every review in a multi-dimension record", () => {
    const reviews: readonly LexiconCandidateReview[] = [
      review({ dimension: "content-es-ES", outcome: "pass", reason: "the form is a legitimate entry" }),
      review({ dimension: "teaching-zh-CN", outcome: "fail" }),
    ];
    const decoded = decodeReviews(encodeReviews(reviews), makeError);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.reason).toBe("the form is a legitimate entry");
    expect(decoded[1]?.outcome).toBe("fail");
    expect(Object.prototype.hasOwnProperty.call(decoded[1]!, "reason")).toBe(false);
    expect(decoded[1]?.reviewedAt).toEqual(reviewedAt);
  });
});
