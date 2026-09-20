import { describe, expect, it, vi } from "vitest";

import { autoPublishMediaCandidate } from "@/src/modules/content-acquisition/application/auto-publish-media";
import type { ContentCandidateRecord, ContentSourceRecord, ContentWorkflowRepository } from "@/src/modules/content-acquisition/repositories";
import type { CandidatePublisherRegistry } from "@/src/modules/content-acquisition/publishers";

const candidate: ContentCandidateRecord = {
  id: "candidate-video-1", sourceId: "source-1", externalItemId: "video-1", normalizedUrl: "https://www.youtube.com/watch?v=video-1", title: "Video", language: "es", metadata: { videoDraft: {} }, publishedAt: null, contentHash: "a".repeat(64), contentType: "video", rightsStatus: "verified", status: "review_ready", generationId: "g1", revision: 3, lastActivityAt: new Date(), rejectedAt: null, publicationStatus: "draft", publicationRef: null, publishedCandidateRevision: null, publishedContentHash: null, publishedAtInternal: null, archivedAt: null,
};
const source: ContentSourceRecord = { id: "source-1", stableKey: "youtube.fixture", adapterType: "youtube", sourceKind: "video-channel", externalSourceId: "fixture", displayName: "Fixture", language: "es", region: "ES", enabled: true, rightsStatus: "verified", cursor: null, revision: 1 };

describe("autoPublishMediaCandidate", () => {
  it("keeps a reviewed YouTube candidate pending until Bunny hosting is complete", async () => {
    const repository = { getCandidateReview: vi.fn(async () => ({ candidate, source, artifacts: [], attempts: [], reviews: [] })) } as unknown as ContentWorkflowRepository;
    const publisher = { require: vi.fn() } as unknown as CandidatePublisherRegistry;
    await expect(autoPublishMediaCandidate(repository, publisher, { candidateId: candidate.id, actor: "media-auto-publication" }))
      .resolves.toMatchObject({ status: "skipped", reason: "MEDIA_VIDEO_HOSTING_REQUIRED" });
    expect(publisher.require).not.toHaveBeenCalled();
  });
});
