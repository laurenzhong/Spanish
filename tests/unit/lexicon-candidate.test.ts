import { describe, expect, it } from "vitest";

import {
  approveCandidate,
  canTransition,
  candidateLemmaStatus,
  isIndexable,
  makeCandidateId,
  recordReview,
  rejectCandidate,
  submitForReview,
  type LexiconCandidate,
  type LexiconCandidateReview,
} from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";

const now = new Date("2026-10-10T12:00:00.000Z");
const later = new Date("2026-10-10T13:00:00.000Z");

function candidate(overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  return {
    id: "lexeme|article.a@1|0|terremoto",
    kind: "lexeme",
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    meaningZh: "地震",
    status: "discovered",
    revision: 1,
    source: {
      documentKind: "article",
      documentStableKey: "article.a",
      documentVersion: 1,
      segmentIndex: 0,
      contextBefore: "Y en Panamá, un ",
      contextAfter: " de magnitud 7.2",
      sourceTitle: "Alerta de tsunami",
      sourceKind: "article-rss",
    },
    reviews: [],
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function pass(dimension: LexiconCandidateReview["dimension"]): LexiconCandidateReview {
  return { dimension, outcome: "pass", reviewerReference: "dsh-ai-owner-authorized-review", reviewedAt: now };
}

function failReview(dimension: LexiconCandidateReview["dimension"]): LexiconCandidateReview {
  return { dimension, outcome: "fail", reviewerReference: "dsh-ai-owner-authorized-review", reviewedAt: now };
}

/** Drive a candidate to `review_ready` with both dimensions passing. */
function reviewed(): LexiconCandidate {
  let current = candidate();
  const submitted = submitForReview(current, { expectedRevision: 1, now });
  if (!submitted.ok) throw new Error("submit failed");
  current = submitted.candidate;

  for (const dimension of ["content-es-ES", "teaching-zh-CN"] as const) {
    const recorded = recordReview(current, { review: pass(dimension), expectedRevision: current.revision, now });
    if (!recorded.ok) throw new Error("review failed");
    current = recorded.candidate;
  }
  return current;
}

describe("lexicon candidate state machine", () => {
  it("only allows discovered -> review_submitted -> review_ready -> approved", () => {
    expect(canTransition("discovered", "review_submitted")).toBe(true);
    expect(canTransition("review_submitted", "review_ready")).toBe(true);
    expect(canTransition("review_ready", "approved")).toBe(true);

    // No shortcut from extraction straight to approval or to ready.
    expect(canTransition("discovered", "approved")).toBe(false);
    expect(canTransition("discovered", "review_ready")).toBe(false);
    expect(canTransition("review_submitted", "approved")).toBe(false);
  });

  it("treats approved and rejected as terminal", () => {
    for (const from of ["approved", "rejected"] as const) {
      for (const to of ["discovered", "review_submitted", "review_ready", "approved", "rejected"] as const) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it("advances a discovered candidate to review_ready after both dimensions pass", () => {
    const ready = reviewed();
    expect(ready.status).toBe("review_ready");
    expect(ready.reviews).toHaveLength(2);
    // Not indexable until a human approves.
    expect(isIndexable(ready)).toBe(false);
    expect(candidateLemmaStatus(ready)).toBe("pending");
  });

  it("refuses approval while review is incomplete", () => {
    let current = candidate();
    const submitted = submitForReview(current, { expectedRevision: 1, now });
    if (!submitted.ok) throw new Error("submit failed");
    current = submitted.candidate;

    const partial = recordReview(current, { review: pass("content-es-ES"), expectedRevision: current.revision, now });
    if (!partial.ok) throw new Error("review failed");
    current = partial.candidate;

    // `review_ready` requires BOTH dimensions, so a half-reviewed candidate is
    // still `review_submitted` and the structural guard rejects the approval.
    expect(current.status).toBe("review_submitted");
    const attempt = approveCandidate(current, { approvedBy: "owner", expectedRevision: current.revision, now: later });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.conflict).toBe("CANDIDATE_INVALID_TRANSITION");
  });

  it("settles a candidate as rejected as soon as one dimension fails, without waiting for the other", () => {
    let current = candidate();
    const submitted = submitForReview(current, { expectedRevision: 1, now });
    if (!submitted.ok) throw new Error("submit failed");
    current = submitted.candidate;

    const failed = recordReview(current, { review: failReview("teaching-zh-CN"), expectedRevision: current.revision, now });
    expect(failed.ok).toBe(true);
    if (!failed.ok) return;
    expect(failed.candidate.status).toBe("rejected");
    expect(failed.candidate.rejectedReason).toBe("REVIEW_DIMENSION_FAILED");
    // A single recorded dimension is enough to settle; no second review needed.
    expect(failed.candidate.reviews).toHaveLength(1);
  });

  it("approves only after both dimensions pass and marks it indexable", () => {
    const ready = reviewed();
    const approved = approveCandidate(ready, { approvedBy: "owner", expectedRevision: ready.revision, now: later });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.candidate.status).toBe("approved");
    expect(approved.candidate.approvedBy).toBe("owner");
    expect(approved.candidate.approvedAt).toEqual(later);
    // This is the single gate that lets the corpus change.
    expect(isIndexable(approved.candidate)).toBe(true);
    expect(candidateLemmaStatus(approved.candidate)).toBe("verified");
  });

  it("rejects a stale revision instead of mutating newer state (expired callback)", () => {
    let current = candidate();
    const submitted = submitForReview(current, { expectedRevision: 1, now });
    if (!submitted.ok) throw new Error("submit failed");
    current = submitted.candidate; // revision 2

    // A late caller still holding revision 1 must not win.
    const stale = recordReview(current, { review: pass("content-es-ES"), expectedRevision: 1, now: later });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.conflict).toBe("CANDIDATE_REVISION_CONFLICT");

    const staleApprove = approveCandidate(current, { approvedBy: "owner", expectedRevision: 1, now: later });
    expect(staleApprove.ok).toBe(false);
    if (!staleApprove.ok) expect(staleApprove.conflict).toBe("CANDIDATE_REVISION_CONFLICT");
  });

  it("does not record the same review dimension twice", () => {
    let current = candidate();
    const submitted = submitForReview(current, { expectedRevision: 1, now });
    if (!submitted.ok) throw new Error("submit failed");
    current = submitted.candidate;

    const first = recordReview(current, { review: pass("content-es-ES"), expectedRevision: current.revision, now });
    if (!first.ok) throw new Error("review failed");
    current = first.candidate;

    const duplicate = recordReview(current, { review: pass("content-es-ES"), expectedRevision: current.revision, now: later });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.conflict).toBe("CANDIDATE_REVIEW_ALREADY_RECORDED");
  });

  it("keeps submission idempotent for the same revision", () => {
    let current = candidate();
    const first = submitForReview(current, { expectedRevision: 1, now });
    if (!first.ok) throw new Error("submit failed");
    current = first.candidate;

    const repeat = submitForReview(current, { expectedRevision: current.revision, now: later });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    // Same revision, no extra state churn.
    expect(repeat.candidate.revision).toBe(current.revision);
    expect(repeat.candidate.status).toBe("review_submitted");
  });

  it("refuses to approve a candidate that was never submitted", () => {
    const fresh = candidate();
    const attempt = approveCandidate(fresh, { approvedBy: "owner", expectedRevision: fresh.revision, now: later });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.conflict).toBe("CANDIDATE_INVALID_TRANSITION");
  });

  it("refuses to resurrect a rejected candidate, even with valid reviews", () => {
    let current = candidate();
    const submitted = submitForReview(current, { expectedRevision: 1, now });
    if (!submitted.ok) throw new Error("submit failed");
    current = submitted.candidate;

    const rejected = rejectCandidate(current, { reason: "NOT_A_LEXEME", expectedRevision: current.revision, now });
    if (!rejected.ok) throw new Error("reject failed");
    current = rejected.candidate;

    const approve = approveCandidate(current, { approvedBy: "owner", expectedRevision: current.revision, now: later });
    expect(approve.ok).toBe(false);
    if (!approve.ok) expect(approve.conflict).toBe("CANDIDATE_REJECTED_IS_TERMINAL");

    const again = rejectCandidate(current, { reason: "AGAIN", expectedRevision: current.revision, now: later });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.conflict).toBe("CANDIDATE_REJECTED_IS_TERMINAL");
  });

  it("stamps provenance into the id so a re-extraction cannot masquerade as the same candidate", () => {
    const base = {
      kind: "lexeme" as const,
      documentKind: "article" as const,
      stableKey: "article.a",
      version: 1,
      segmentIndex: 0,
      normalizedText: "terremoto",
    };
    expect(makeCandidateId(base)).toBe("lexeme|article|article.a|1|0|terremoto");
    expect(makeCandidateId({ ...base, version: 2 })).not.toBe(makeCandidateId(base));
    expect(makeCandidateId({ ...base, segmentIndex: 1 })).not.toBe(makeCandidateId(base));
    expect(makeCandidateId({ ...base, normalizedText: "sismo" })).not.toBe(makeCandidateId(base));
  });

  it("keeps the id and the table's unique index in step by encoding documentKind", () => {
    // The unique index includes document_kind, so the id must too; otherwise the
    // same stable key under two kinds would fold into one id and an id-only
    // lookup could not tell them apart.
    const shared = { kind: "lexeme" as const, stableKey: "mix.es", version: 1, segmentIndex: 0, normalizedText: "casa" };
    const asArticle = makeCandidateId({ ...shared, documentKind: "article" });
    const asMedia = makeCandidateId({ ...shared, documentKind: "media" });
    expect(asArticle).not.toBe(asMedia);
    expect(asArticle).toContain("|article|");
    expect(asMedia).toContain("|media|");
  });

  it("increments revision exactly once per accepted transition", () => {
    let current = candidate();
    expect(current.revision).toBe(1);

    const submitted = submitForReview(current, { expectedRevision: 1, now });
    if (!submitted.ok) throw new Error("submit failed");
    current = submitted.candidate;
    expect(current.revision).toBe(2);

    const first = recordReview(current, { review: pass("content-es-ES"), expectedRevision: 2, now });
    if (!first.ok) throw new Error("review failed");
    current = first.candidate;
    expect(current.revision).toBe(3);

    const second = recordReview(current, { review: pass("teaching-zh-CN"), expectedRevision: 3, now });
    if (!second.ok) throw new Error("review failed");
    current = second.candidate;
    expect(current.revision).toBe(4);
    expect(current.status).toBe("review_ready");

    const approved = approveCandidate(current, { approvedBy: "owner", expectedRevision: 4, now: later });
    if (!approved.ok) throw new Error("approve failed");
    expect(approved.candidate.revision).toBe(5);
  });
});
