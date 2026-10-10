// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  LEGACY_OWNER_AUTHORIZED_REVIEWER_REFERENCE,
  isOwnerAuthorizedReviewerReference,
  ownerAuthorizedReviewerReference,
} from "@/src/modules/content-acquisition/domain/review-identity";
import { assertCandidatePublishable } from "@/src/modules/content-acquisition/domain/review-gate";

const CONTENT_HASH = "a".repeat(64);

const publishableCandidate = {
  id: "candidate-1",
  contentType: "video" as const,
  status: "review_ready",
  rightsStatus: "verified",
  revision: 3,
  contentHash: CONTENT_HASH,
  publicationStatus: "draft" as const,
};

function approvals(reviewerReference: string) {
  return (["content-es-ES", "teaching-zh-CN", "structure"] as const).map((dimension, index) => ({
    id: `review-${index}`,
    candidateId: "candidate-1",
    dimension,
    status: "approved" as const,
    reviewerReference,
    candidateRevision: 3,
    notes: null,
  }));
}

describe("owner-authorized AI review identity", () => {
  it("keeps the historical Codex reference valid for existing audit records", () => {
    expect(isOwnerAuthorizedReviewerReference(LEGACY_OWNER_AUTHORIZED_REVIEWER_REFERENCE)).toBe(true);
  });

  it("writes the DSH reference for new reviews", () => {
    expect(ownerAuthorizedReviewerReference()).toBe("dsh-ai-owner-authorized-review");
    expect(isOwnerAuthorizedReviewerReference("dsh-ai-owner-authorized-review")).toBe(true);
  });

  it("records sanitized actor and run provenance on the DSH reference", () => {
    const reference = ownerAuthorizedReviewerReference({ actor: "article-auto-publication:readlang-links-v6", runId: "run 42" });

    expect(reference).toBe("dsh-ai-owner-authorized-review:article-auto-publication:readlang-links-v6:run-42");
    expect(reference.length).toBeLessThanOrEqual(300);
  });

  it("rejects unknown or empty reviewer references", () => {
    for (const value of ["", null, undefined, "codex-ai-temporary-review", "dsh-ai-owner-authorized-reviewer", "human-native-speaker"]) {
      expect(isOwnerAuthorizedReviewerReference(value)).toBe(false);
    }
  });
});

describe("candidate publication gate with migrated review identities", () => {
  const expected = { expectedRevision: 3, expectedContentHash: CONTENT_HASH };

  it("still publishes records approved by the historical Codex identity", () => {
    expect(() => assertCandidatePublishable(publishableCandidate, approvals(LEGACY_OWNER_AUTHORIZED_REVIEWER_REFERENCE), expected)).not.toThrow();
  });

  it("publishes records approved by the DSH identity", () => {
    expect(() => assertCandidatePublishable(publishableCandidate, approvals(ownerAuthorizedReviewerReference()), expected)).not.toThrow();
  });

  it("publishes records approved by an unattended DSH run identity", () => {
    const reference = ownerAuthorizedReviewerReference({ actor: "media-auto-publication", runId: "2026-10-10" });

    expect(() => assertCandidatePublishable(publishableCandidate, approvals(reference), expected)).not.toThrow();
  });

  it("refuses an approval that is not owner-authorized AI review", () => {
    expect(() => assertCandidatePublishable(publishableCandidate, approvals("codex-ai-temporary-review"), expected)).toThrow(/Missing content-es-ES approval/u);
  });

  it("refuses a mixed revision approval", () => {
    const reviews = approvals(ownerAuthorizedReviewerReference()).map((review, index) => (index === 0 ? { ...review, candidateRevision: 2 } : review));

    expect(() => assertCandidatePublishable(publishableCandidate, reviews, expected)).toThrow(/Missing content-es-ES approval/u);
  });
});
