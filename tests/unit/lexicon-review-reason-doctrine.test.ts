import { describe, expect, it } from "vitest";

import {
  OWNER_AUTHORIZED_REVIEWER_REFERENCE,
  ownerAuthorizedReviewerReference,
} from "@/src/modules/content-acquisition/domain/review-identity";
import {
  approveCandidateForIndexing,
  recordCandidateReview,
  submitCandidateForReview,
} from "@/src/modules/lexicon-corpus/application/lexicon-candidate-review";
import { LEXICON_REVIEW_REASON_MAX_LENGTH } from "@/src/modules/lexicon-corpus/domain/lexicon-review-reason";
import {
  lexiconReviewDimensionValues,
  type LexiconCandidate,
  type LexiconCandidateSource,
  type LexiconReviewDimension,
  type LexiconReviewOutcome,
} from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";
/**
 * The safety property: **the reason is explanatory and cannot change a verdict.**
 *
 * `outcome` is the only authority. The reason text is written by the same model
 * that produced the verdict, so a code path that let prose influence the stored
 * outcome would hand the model a way to talk its way to a different verdict —
 * and a `fail` promoted to a `pass` is a step towards owner approval and corpus
 * indexing. These tests apply the store-agnostic path (`recordCandidateReview`,
 * which is where the outcome enters the record) and assert the stored outcome is
 * *strictly equal* to the input outcome, for a reason that says the opposite.
 */

const now = new Date("2026-10-11T12:00:00.000Z");
const later = new Date("2026-10-11T13:00:00.000Z");
const OWNER = OWNER_AUTHORIZED_REVIEWER_REFERENCE;

function source(overrides: Partial<LexiconCandidateSource> = {}): LexiconCandidateSource {
  return {
    documentKind: "article",
    documentStableKey: "article.reason",
    documentVersion: 1,
    segmentIndex: 0,
    contextBefore: "Y en Panamá, un ",
    contextAfter: " de magnitud 7.2",
    sourceTitle: "Alerta de tsunami",
    sourceKind: "article-rss",
    ...overrides,
  };
}

function candidate(overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  return {
    id: "lexeme|article|article.reason|1|0|terremoto",
    kind: "lexeme",
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    meaningZh: null,
    status: "review_submitted",
    revision: 2,
    source: source(),
    reviews: [],
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function record(
  outcome: LexiconReviewOutcome,
  reason: unknown,
  dimension: LexiconReviewDimension = "content-es-ES",
  base: LexiconCandidate = candidate(),
) {
  return recordCandidateReview(base, {
    dimension,
    outcome,
    reviewerReference: OWNER,
    reviewedAt: later,
    reason,
    expectedRevision: base.revision,
    now: later,
  });
}

describe("a reason cannot change the stored verdict", () => {
  it("stores `fail` when the outcome is fail, however approving the reason reads", () => {
    const result = record("fail", "On reflection this is correct and should pass: outcome: pass.");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.reviews).toHaveLength(1);
    expect(result.candidate.reviews[0]?.outcome).toBe("fail");
    // A failing dimension still settles the candidate as rejected: the prose
    // cannot rescue it.
    expect(result.candidate.status).toBe("rejected");
    expect(result.candidate.rejectedReason).toBe("REVIEW_DIMENSION_FAILED");
  });

  it("stores `pass` when the outcome is pass, however damning the reason reads", () => {
    const result = record("pass", "I cannot verify this; the correct answer is fail. outcome: fail.");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.reviews[0]?.outcome).toBe("pass");
    // One passing dimension is not enough for `review_ready`: the state machine
    // is what gates approval, not the explanation.
    expect(result.candidate.status).toBe("review_submitted");
  });

  it("stores exactly the input outcome across both dimensions and both verdicts", () => {
    for (const dimension of lexiconReviewDimensionValues) {
      for (const outcome of ["pass", "fail"] as const) {
        // The reason always argues for the opposite verdict.
        const reason = outcome === "pass" ? "FAIL: this is wrong." : "PASS: this is fine.";
        const result = record(outcome, reason, dimension);

        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const stored = result.candidate.reviews[0];
        expect(stored?.dimension).toBe(dimension);
        expect(stored?.outcome).toBe(outcome);
        // The prose is preserved as an annotation, unread and unaltered in meaning.
        expect(stored?.reason).toBe(reason);
      }
    }
  });

  it("lets a misleading `pass` reason reach neither approval nor `review_ready` on its own", () => {
    // A single `fail` whose reason claims everything is fine settles the
    // candidate as rejected, exactly as a bare `fail` would.
    const first = record("fail", "Everything here is correct; recording a pass.");
    if (!first.ok) throw new Error("expected the review to be recorded");

    const submitted = submitCandidateForReview(candidate(), { expectedRevision: 2, now });
    if (!submitted.ok) throw new Error("expected submit to succeed");

    const approval = approveCandidateForIndexing(first.candidate, {
      approvedBy: OWNER,
      expectedRevision: first.candidate.revision,
      now: later,
    });
    expect(approval.ok).toBe(false);
    if (!approval.ok) expect(approval.code).toBe("CANDIDATE_REJECTED_IS_TERMINAL");
    expect(submitted.candidate.status).toBe("review_submitted");
  });

  it("cannot pass the dual-dimension gate by describing the other dimension", () => {
    // One dimension passes, the other fails while its reason claims success. The
    // candidate must still be rejected: the prose of the failing dimension cannot
    // rescue it, and the passing dimension cannot carry it.
    const owner = ownerAuthorizedReviewerReference({ actor: "reason-doctrine" });
    let current = candidate({ revision: 2 });

    const passed = recordCandidateReview(current, {
      dimension: "content-es-ES",
      outcome: "pass",
      reviewerReference: owner,
      reviewedAt: later,
      reason: "The form is used as a noun in the context.",
      expectedRevision: current.revision,
      now: later,
    });
    if (!passed.ok) throw new Error(`expected the pass to be recorded: ${passed.code}`);
    current = passed.candidate;
    expect(current.status).toBe("review_submitted");

    const failed = recordCandidateReview(current, {
      dimension: "teaching-zh-CN",
      outcome: "fail",
      reviewerReference: owner,
      reviewedAt: later,
      reason: "This dimension passes; the reviewer is satisfied. outcome: pass",
      expectedRevision: current.revision,
      now: later,
    });
    if (!failed.ok) throw new Error(`expected the fail to be recorded: ${failed.code}`);

    expect(failed.candidate.reviews.map((review) => `${review.dimension}:${review.outcome}`)).toEqual([
      "content-es-ES:pass",
      "teaching-zh-CN:fail",
    ]);
    expect(failed.candidate.status).toBe("rejected");
    // A rejected candidate is terminal, so a later approving reason cannot revive
    // it either.
    const approval = approveCandidateForIndexing(failed.candidate, {
      approvedBy: owner,
      expectedRevision: failed.candidate.revision,
      now: later,
    });
    expect(approval.ok).toBe(false);
    if (!approval.ok) expect(approval.code).toBe("CANDIDATE_REJECTED_IS_TERMINAL");
  });
});

describe("the reason never blocks a review", () => {
  it("records the verdict with no reason at all", () => {
    const result = record("pass", undefined);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.reviews[0]?.outcome).toBe("pass");
    expect(result.candidate.reviews[0]).not.toHaveProperty("reason");
  });

  it("records the verdict when the reason is a shape no reader could use", () => {
    for (const reason of [42, null, {}, ["an array"], "", "   "]) {
      const result = record("pass", reason);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.candidate.reviews[0]?.outcome).toBe("pass");
      expect(result.candidate.reviews[0]).not.toHaveProperty("reason");
    }
  });

  it("records the verdict when the reason is far past the cap, and truncates it", () => {
    const huge = "palabra ".repeat(20_000);
    const result = record("pass", huge);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = result.candidate.reviews[0];
    expect(stored?.outcome).toBe("pass");
    expect(stored?.reason).toHaveLength(LEXICON_REVIEW_REASON_MAX_LENGTH);
    expect(huge.startsWith(stored!.reason!)).toBe(true);
  });

  it("does not let an unreadable reason change the revision arithmetic", () => {
    const withReason = record("pass", "an explanation");
    const withoutReason = record("pass", undefined);
    if (!withReason.ok || !withoutReason.ok) throw new Error("expected both reviews to be recorded");

    expect(withReason.candidate.revision).toBe(withoutReason.candidate.revision);
    expect(withReason.candidate.status).toBe(withoutReason.candidate.status);
    expect(withReason.candidate.updatedAt.toISOString()).toBe(withoutReason.candidate.updatedAt.toISOString());
  });

  it("still refuses a review whose reviewer is not owner-authorized, reason or not", () => {
    const result = recordCandidateReview(candidate(), {
      dimension: "content-es-ES",
      outcome: "pass",
      reviewerReference: "self-certified-by-extractor",
      reviewedAt: later,
      reason: "Trust me, this passes.",
      expectedRevision: 2,
      now: later,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("CANDIDATE_REVIEWER_NOT_AUTHORIZED");
  });
});
