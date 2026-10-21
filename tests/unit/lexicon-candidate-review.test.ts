import { describe, expect, it } from "vitest";

import {
  LEGACY_OWNER_AUTHORIZED_REVIEWER_REFERENCE,
  OWNER_AUTHORIZED_REVIEWER_REFERENCE,
  ownerAuthorizedReviewerReference,
} from "@/src/modules/content-acquisition/domain/review-identity";
import {
  approveCandidateForIndexing,
  candidateHasBothReviewDimensions,
  candidateHasFrozenSource,
  recordCandidateReview,
  submitCandidateForReview,
  type LexiconCandidateReviewFailureCode,
  type LexiconCandidateReviewResult,
} from "@/src/modules/lexicon-corpus/application/lexicon-candidate-review";
import type {
  LexiconCandidate,
  LexiconCandidateSource,
  LexiconReviewDimension,
} from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";

/**
 * Slice 4: the application layer joins the candidate state machine to the shared
 * owner-authorized review identity. These tests drive the application entry
 * points (not the domain functions directly) so the wiring is what is verified.
 */

const now = new Date("2026-10-10T12:00:00.000Z");
const later = new Date("2026-10-10T13:00:00.000Z");
const OWNER = OWNER_AUTHORIZED_REVIEWER_REFERENCE;

const dimensions = ["content-es-ES", "teaching-zh-CN"] as const;

function source(overrides: Partial<LexiconCandidateSource> = {}): LexiconCandidateSource {
  return {
    documentKind: "article",
    documentStableKey: "article.a",
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
    id: "lexeme|article.a|1|0|terremoto",
    kind: "lexeme",
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    meaningZh: null,
    status: "discovered",
    revision: 1,
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

function unwrap(result: LexiconCandidateReviewResult): LexiconCandidate {
  if (!result.ok) throw new Error(`unexpected failure: ${result.code}`);
  return result.candidate;
}

function failureCode(result: LexiconCandidateReviewResult): LexiconCandidateReviewFailureCode {
  if (result.ok) throw new Error("expected a failure result");
  return result.code;
}

function submitted(overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  const start = candidate(overrides);
  return unwrap(submitCandidateForReview(start, { expectedRevision: start.revision, now }));
}

function reviewPass(
  current: LexiconCandidate,
  dimension: LexiconReviewDimension,
  reviewerReference: string = OWNER,
  reviewedAt: Date = now,
) {
  return recordCandidateReview(current, {
    dimension,
    outcome: "pass",
    reviewerReference,
    reviewedAt,
    expectedRevision: current.revision,
    now,
  });
}

/** Drive a candidate to `review_ready` through the application entry points. */
function reviewed(overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  let current = submitted(overrides);
  for (const dimension of dimensions) {
    current = unwrap(reviewPass(current, dimension));
  }
  return current;
}

describe("candidate review orchestration (LEX-INDEX-001 slice 4)", () => {
  it("reaches review_ready only after both dimensions pass", () => {
    let current = submitted();
    expect(current.status).toBe("review_submitted");
    expect(current.reviews).toHaveLength(0);

    current = unwrap(reviewPass(current, "content-es-ES"));
    // One dimension is never enough to unlock approval.
    expect(current.status).toBe("review_submitted");
    expect(candidateHasBothReviewDimensions(current)).toBe(false);

    current = unwrap(reviewPass(current, "teaching-zh-CN"));
    expect(current.status).toBe("review_ready");
    expect(candidateHasBothReviewDimensions(current)).toBe(true);

    // Reviewing must not publish: approval is a separate, later act.
    expect(current.approvedBy).toBeNull();
    expect(current.approvedAt).toBeNull();
  });

  it("accepts the current DSH owner-authorized identity and its audited provenance form", () => {
    for (const reference of [
      OWNER_AUTHORIZED_REVIEWER_REFERENCE,
      ownerAuthorizedReviewerReference({ actor: "lexicon-candidate-review", runId: "run-1" }),
    ]) {
      const current = submitted();
      const result = reviewPass(current, "content-es-ES", reference);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.candidate.reviews[0]?.reviewerReference).toBe(reference);
    }
  });

  it("still accepts the historical codex owner-authorized identity", () => {
    const current = submitted();
    const result = reviewPass(current, "content-es-ES", LEGACY_OWNER_AUTHORIZED_REVIEWER_REFERENCE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.reviews[0]?.reviewerReference).toBe(LEGACY_OWNER_AUTHORIZED_REVIEWER_REFERENCE);
  });

  it("rejects an unknown reviewer identity and leaves the candidate untouched", () => {
    const unknowns = [
      "",
      "human-native-reviewer",
      // The temporary review identity is not an owner authorization.
      "codex-ai-temporary-review",
      "dsh-ai-owner-authorized-reviewer",
      "DSH-AI-OWNER-AUTHORIZED-REVIEW",
      "dsh-ai-owner-authorized-review:run:with:too:many:segments",
    ];
    for (const reviewerReference of unknowns) {
      const current = submitted();
      const result = reviewPass(current, "content-es-ES", reviewerReference);
      expect(failureCode(result)).toBe("CANDIDATE_REVIEWER_NOT_AUTHORIZED");
    }
  });

  it("records the reviewer reference and the review timestamp verbatim", () => {
    const reviewedAt = new Date("2026-10-10T09:30:00.000Z");
    const current = submitted();
    const result = recordCandidateReview(current, {
      dimension: "teaching-zh-CN",
      outcome: "pass",
      reviewerReference: OWNER,
      reviewedAt,
      expectedRevision: current.revision,
      // Deliberately different from `reviewedAt`: the record must carry the
      // review's own timestamp, not the clock of this call.
      now: later,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.reviews).toEqual([
      { dimension: "teaching-zh-CN", outcome: "pass", reviewerReference: OWNER, reviewedAt },
    ]);
    expect(result.candidate.updatedAt).toEqual(later);
  });

  it("refuses a review record whose reviewedAt is missing or unusable", () => {
    const current = submitted();
    for (const reviewedAt of [new Date("not-a-date"), undefined as unknown as Date]) {
      const result = recordCandidateReview(current, {
        dimension: "content-es-ES",
        outcome: "pass",
        reviewerReference: OWNER,
        reviewedAt,
        expectedRevision: current.revision,
        now,
      });
      expect(failureCode(result)).toBe("CANDIDATE_REVIEW_RECORD_INCOMPLETE");
    }
  });

  it("refuses a candidate without a complete frozen source", () => {
    const brokenSources: Partial<LexiconCandidateSource>[] = [
      { documentStableKey: "   " },
      { documentVersion: 0 },
      { segmentIndex: -1 },
      { sourceTitle: "" },
      { sourceKind: "" },
    ];
    for (const broken of brokenSources) {
      const current = candidate({ source: source(broken) });
      expect(candidateHasFrozenSource(current)).toBe(false);
      expect(
        failureCode(submitCandidateForReview(current, { expectedRevision: current.revision, now })),
      ).toBe("CANDIDATE_SOURCE_NOT_FROZEN");

      // Even a candidate that was submitted while its source was intact is
      // refused once the frozen provenance is gone.
      const afterSubmit = { ...submitted(), source: source(broken) };
      expect(failureCode(reviewPass(afterSubmit, "content-es-ES"))).toBe("CANDIDATE_SOURCE_NOT_FROZEN");

      // Approval is the last step before the corpus write, so it checks too.
      const prepared = { ...reviewed(), source: source(broken) };
      expect(failureCode(approveCandidateForIndexing(prepared, {
        approvedBy: OWNER,
        expectedRevision: prepared.revision,
        now: later,
      }))).toBe("CANDIDATE_SOURCE_NOT_FROZEN");
    }
  });

  it("settles the candidate as rejected as soon as one dimension fails", () => {
    const current = submitted();
    const result = recordCandidateReview(current, {
      dimension: "teaching-zh-CN",
      outcome: "fail",
      reviewerReference: OWNER,
      reviewedAt: now,
      expectedRevision: current.revision,
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.status).toBe("rejected");
    expect(result.candidate.rejectedReason).toBe("REVIEW_DIMENSION_FAILED");
  });

  it("refuses a stale revision instead of mutating newer state (expired callback)", () => {
    const current = submitted(); // revision 2
    expect(
      failureCode(
        recordCandidateReview(current, {
          dimension: "content-es-ES",
          outcome: "pass",
          reviewerReference: OWNER,
          reviewedAt: now,
          expectedRevision: 1,
          now: later,
        }),
      ),
    ).toBe("CANDIDATE_REVISION_CONFLICT");

    const ready = reviewed();
    expect(
      failureCode(
        approveCandidateForIndexing(ready, { approvedBy: OWNER, expectedRevision: ready.revision - 1, now: later }),
      ),
    ).toBe("CANDIDATE_REVISION_CONFLICT");
  });

  it("does not record the same review dimension twice", () => {
    const first = unwrap(reviewPass(submitted(), "content-es-ES"));
    expect(failureCode(reviewPass(first, "content-es-ES"))).toBe("CANDIDATE_REVIEW_ALREADY_RECORDED");
  });
});

describe("owner approval gate is identity-checked and pure (LEX-INDEX-001 slice 4)", () => {
  it("approves a review_ready candidate and stamps the owner provenance", () => {
    const ready = reviewed();
    const result = approveCandidateForIndexing(ready, {
      approvedBy: OWNER,
      expectedRevision: ready.revision,
      now: later,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.status).toBe("approved");
    expect(result.candidate.approvedBy).toBe(OWNER);
    expect(result.candidate.approvedAt).toEqual(later);
    expect(result.candidate.revision).toBe(ready.revision + 1);
    // Approval is the only thing that flips the honesty flag on the lemma.
    expect(candidateHasBothReviewDimensions(result.candidate)).toBe(true);
  });

  it("refuses an approver that is not owner-authorized", () => {
    const ready = reviewed();
    for (const approvedBy of ["owner", "", "human-teacher", "codex-ai-temporary-review"]) {
      const result = approveCandidateForIndexing(ready, {
        approvedBy,
        expectedRevision: ready.revision,
        now: later,
      });
      expect(failureCode(result)).toBe("CANDIDATE_REVIEWER_NOT_AUTHORIZED");
    }
  });

  it("refuses approval while the review is incomplete", () => {
    const half = unwrap(reviewPass(submitted(), "content-es-ES"));
    expect(failureCode(approveCandidateForIndexing(half, {
      approvedBy: OWNER,
      expectedRevision: half.revision,
      now: later,
    }))).toBe("CANDIDATE_INVALID_TRANSITION");

    // A candidate whose status claims `review_ready` but whose review rows are
    // incomplete must not pass either: the data check backs up the state machine.
    const forged = candidate({ status: "review_ready", revision: 4, reviews: [
      { dimension: "content-es-ES", outcome: "pass", reviewerReference: OWNER, reviewedAt: now },
    ] });
    expect(failureCode(approveCandidateForIndexing(forged, {
      approvedBy: OWNER,
      expectedRevision: forged.revision,
      now: later,
    }))).toBe("CANDIDATE_REVIEW_INCOMPLETE");
  });

  it("refuses to approve a candidate that was never submitted", () => {
    const fresh = candidate();
    expect(failureCode(approveCandidateForIndexing(fresh, {
      approvedBy: OWNER,
      expectedRevision: fresh.revision,
      now: later,
    }))).toBe("CANDIDATE_INVALID_TRANSITION");
  });

  it("keeps a rejected candidate rejected (terminal, no resurrection)", () => {
    const current = submitted();
    const rejected = recordCandidateReview(current, {
      dimension: "content-es-ES",
      outcome: "fail",
      reviewerReference: OWNER,
      reviewedAt: now,
      expectedRevision: current.revision,
      now,
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    expect(failureCode(approveCandidateForIndexing(rejected.candidate, {
      approvedBy: OWNER,
      expectedRevision: rejected.candidate.revision,
      now: later,
    }))).toBe("CANDIDATE_REJECTED_IS_TERMINAL");
  });

  it("keeps submission idempotent for the same revision", () => {
    const current = submitted();
    const repeat = submitCandidateForReview(current, { expectedRevision: current.revision, now: later });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.candidate.revision).toBe(current.revision);
    expect(repeat.candidate.status).toBe("review_submitted");
  });
});
