// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContentPublicationConflictError,
  ContentPublisherNotAvailableError,
  ContentReviewIncompleteError,
  CandidatePublisherRegistry,
  assertCandidatePublishable,
  publishCandidate,
} from "@/src/modules/content-acquisition";
import type { ContentWorkflowRepository } from "@/src/modules/content-acquisition/repositories";

const hash = "a".repeat(64);
const candidate = {
  id: "00000000-0000-4000-8000-000000000711",
  contentType: "article" as const,
  status: "review_ready" as const,
  rightsStatus: "verified" as const,
  revision: 5,
  contentHash: hash,
  publicationStatus: "draft" as const,
};

function approved(dimension: "content-es-ES" | "teaching-zh-CN" | "structure") {
  return {
    id: `${dimension}-review`,
    candidateId: candidate.id,
    dimension,
    status: "approved" as const,
    reviewerReference: "codex-ai-owner-authorized-review",
    candidateRevision: candidate.revision,
    notes: null,
  };
}

describe("content candidate publication gate", () => {
  const previousOwners = process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
  afterEach(() => {
    if (previousOwners === undefined) delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
    else process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = previousOwners;
  });
  it("requires independently recorded es-ES, zh-CN, and structure approvals", () => {
    expect(() => assertCandidatePublishable(candidate, [approved("content-es-ES")], {
      expectedRevision: 5,
      expectedContentHash: hash,
    })).toThrow(ContentReviewIncompleteError);

    expect(() => assertCandidatePublishable(candidate, [
      approved("content-es-ES"), approved("teaching-zh-CN"), approved("structure"),
    ], { expectedRevision: 5, expectedContentHash: hash })).not.toThrow();
  });

  it("does not infer approval from generator metadata or a previous revision", () => {
    const generated = { ...candidate, metadata: { generatedBy: "codex-ai-owner-authorized-review" } };
    expect(() => assertCandidatePublishable(generated, [
      { ...approved("content-es-ES"), candidateRevision: 4 },
      approved("teaching-zh-CN"), approved("structure"),
    ], { expectedRevision: 5, expectedContentHash: hash })).toThrow(ContentReviewIncompleteError);
  });

  it("revalidates acquisition state, rights, hash, revision, and publication state", () => {
    const reviews = [approved("content-es-ES"), approved("teaching-zh-CN"), approved("structure")];
    expect(() => assertCandidatePublishable({ ...candidate, rightsStatus: "revoked" as const }, reviews, { expectedRevision: 5, expectedContentHash: hash })).toThrow(ContentReviewIncompleteError);
    expect(() => assertCandidatePublishable(candidate, reviews, { expectedRevision: 4, expectedContentHash: hash })).toThrow(ContentPublicationConflictError);
    expect(() => assertCandidatePublishable(candidate, reviews, { expectedRevision: 5, expectedContentHash: "b".repeat(64) })).toThrow(ContentPublicationConflictError);
    expect(() => assertCandidatePublishable({ ...candidate, publicationStatus: "published" as const }, reviews, { expectedRevision: 5, expectedContentHash: hash })).toThrow(ContentPublicationConflictError);
  });

  it("uses an explicitly registered deterministic publisher and records its immutable reference", async () => {
    const ownerUserId = "00000000-0000-4000-8000-000000000713";
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = ownerUserId;
    const fullCandidate = {
      ...candidate,
      sourceId: "00000000-0000-4000-8000-000000000714", externalItemId: "article-1",
      normalizedUrl: "https://example.test/article", title: "Artículo", language: "es", metadata: {}, publishedAt: null,
      generationId: "generation-1", lastActivityAt: new Date(), rejectedAt: null,
      publicationRef: null, publishedCandidateRevision: null, publishedContentHash: null, publishedAtInternal: null, archivedAt: null,
    };
    const detail = {
      candidate: fullCandidate,
      source: { id: fullCandidate.sourceId, stableKey: "fixture", adapterType: "fake" as const, sourceKind: "article-feed" as const, externalSourceId: "feed", displayName: "Fixture", language: "es", region: null, enabled: true, rightsStatus: "verified" as const, cursor: null, revision: 1 },
      artifacts: [], attempts: [], reviews: [approved("content-es-ES"), approved("teaching-zh-CN"), approved("structure")],
    };
    const markCandidatePublished = vi.fn(async (input) => ({ ...fullCandidate, publicationStatus: "published" as const, publicationRef: input.publicationRef }));
    const repository = { getCandidateReview: vi.fn(async () => detail), markCandidatePublished } as unknown as ContentWorkflowRepository;
    const publisher = { contentType: "article" as const, publish: vi.fn(async () => ({ kind: "article" as const, stableKey: "article.fixture", version: 1 })), archive: vi.fn(async () => undefined) };
    const result = await publishCandidate(repository, new CandidatePublisherRegistry([publisher]), { ownerUserId, candidateId: candidate.id, expectedRevision: 5, expectedContentHash: hash }, { makeReviewId: () => "00000000-0000-4000-8000-000000000715", now: () => new Date("2026-09-13T00:00:00.000Z") });
    expect(result.publicationRef).toEqual({ kind: "article", stableKey: "article.fixture", version: 1 });
    expect(markCandidatePublished).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5, expectedContentHash: hash }));
  });

  it("fails honestly when no publisher exists for the candidate type", async () => {
    const ownerUserId = "00000000-0000-4000-8000-000000000716";
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = ownerUserId;
    const detail = { candidate: { ...candidate, sourceId: "s", externalItemId: "e", normalizedUrl: "https://example.test", title: "Artículo", language: "es", metadata: {}, publishedAt: null, generationId: "g", lastActivityAt: new Date(), rejectedAt: null, publicationRef: null, publishedCandidateRevision: null, publishedContentHash: null, publishedAtInternal: null, archivedAt: null }, source: {}, artifacts: [], attempts: [], reviews: [approved("content-es-ES"), approved("teaching-zh-CN"), approved("structure")] };
    const repository = { getCandidateReview: vi.fn(async () => detail) } as unknown as ContentWorkflowRepository;
    await expect(publishCandidate(repository, new CandidatePublisherRegistry(), { ownerUserId, candidateId: candidate.id, expectedRevision: 5, expectedContentHash: hash })).rejects.toBeInstanceOf(ContentPublisherNotAvailableError);
  });
});
