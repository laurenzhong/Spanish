import { describe, expect, it, vi } from "vitest";

import { autoPublishArticleCandidate } from "@/src/modules/content-acquisition/application/auto-publish-article";
import type { CandidateReviewRecord } from "@/src/modules/content-acquisition/domain";
import type { CandidatePublisherRegistry } from "@/src/modules/content-acquisition/publishers";
import type { ContentCandidateRecord, ContentSourceRecord, ContentWorkflowRepository } from "@/src/modules/content-acquisition/repositories";

const hash = "a".repeat(64);
const candidate: ContentCandidateRecord = {
  id: "candidate-1", sourceId: "source-1", externalItemId: "item-1", normalizedUrl: "https://example.test/article", title: "Artículo", language: "es", metadata: { articleDraft: { contentHash: hash, canonicalUrl: "https://example.test/article", title: "Artículo" } }, publishedAt: null, contentHash: hash, contentType: "article", rightsStatus: "verified", status: "review_ready", generationId: "g1", revision: 3, lastActivityAt: new Date(), rejectedAt: null, publicationStatus: "draft", publicationRef: null, publishedCandidateRevision: null, publishedContentHash: null, publishedAtInternal: null, archivedAt: null,
};
const reviews: CandidateReviewRecord[] = (["content-es-ES", "teaching-zh-CN", "structure"] as const).map((dimension) => ({ id: dimension, candidateId: candidate.id, dimension, status: "approved", reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 3, notes: null }));
const source: ContentSourceRecord = { id: "source-1", stableKey: "fixture", adapterType: "article-rss", sourceKind: "article-feed", externalSourceId: "fixture", displayName: "Fixture", language: "es", region: "ES", enabled: true, rightsStatus: "verified", rightsPolicy: { automatedPublication: { enabled: true, policyVersion: "p1", approvedAt: "2026-09-18T00:00:00.000Z" } }, cursor: null, revision: 1 };

function setup() {
  const markCandidatePublished = vi.fn(async () => candidate);
  const repository = { getCandidateReview: vi.fn(async () => ({ candidate, source, artifacts: [], attempts: [], reviews })), findSourceById: vi.fn(async () => source), markCandidatePublished } as unknown as ContentWorkflowRepository;
  const publisher = { contentType: "article", publish: vi.fn(async () => ({ kind: "article" as const, stableKey: "article.fixture", version: 1 })), archive: vi.fn(async () => undefined) };
  const publishers = { require: vi.fn(() => publisher) } as unknown as CandidatePublisherRegistry;
  return { repository, publishers, publisher, markCandidatePublished };
}

describe("autoPublishArticleCandidate", () => {
  it("publishes only in auto-publish mode with an approved source policy", async () => {
    const { repository, publishers, publisher, markCandidatePublished } = setup();
    const result = await autoPublishArticleCandidate(repository, publishers, { candidateId: candidate.id, mode: "auto-publish", policyVersion: "p1", actor: "article-auto-publication:p1", makeReviewId: () => "owner-release", now: () => new Date("2026-09-18T01:00:00.000Z") });
    expect(result).toMatchObject({ status: "published", publicationRef: { kind: "article" } });
    expect(publisher.publish).toHaveBeenCalledOnce();
    expect(markCandidatePublished).toHaveBeenCalledOnce();
  });

  it("keeps review-only runs from publishing", async () => {
    const { repository, publishers, publisher } = setup();
    await expect(autoPublishArticleCandidate(repository, publishers, { candidateId: candidate.id, mode: "review-only", policyVersion: "p1", actor: "article-auto-publication:p1" })).resolves.toMatchObject({ status: "skipped", reason: "MODE_NOT_AUTO_PUBLISH" });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("fails closed when the source policy version is not approved", async () => {
    const { repository, publishers, publisher } = setup();
    await expect(autoPublishArticleCandidate(repository, publishers, { candidateId: candidate.id, mode: "auto-publish", policyVersion: "p2", actor: "article-auto-publication:p2" })).resolves.toMatchObject({ status: "skipped", reason: "SOURCE_POLICY_NOT_APPROVED" });
    expect(publisher.publish).not.toHaveBeenCalled();
  });
});
