// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createVideoCandidateDraft,
  prepareVideoCandidateForReview,
  type ContentAcquisitionRepository,
  type ContentCandidateRecord,
} from "@/src/modules/content-acquisition";

function videoDraft() {
  return createVideoCandidateDraft({
    stableKey: "youtube.publicvideo1", platform: "youtube", platformVideoId: "publicVideo1", sourceChannelId: "UCabcdefghijklmnopqrstuv",
    canonicalUrl: "https://www.youtube.com/watch?v=publicVideo1", embedUrl: "https://www.youtube-nocookie.com/embed/publicVideo1?enablejsapi=1",
    title: "Cómo pedir un café", summary: "Una conversación breve.", sourceName: "Español con calma", language: "es", region: "es-ES", cefr: "A2", topics: ["topic.daily-life"], durationMs: 245_000,
    publicationDate: "2026-09-13T08:00:00.000Z", fetchedAt: "2026-09-13T10:00:00.000Z", license: "licensed", attribution: "Español con calma en YouTube", licenseEvidence: "https://www.youtube.com/t/terms", copyrightStatus: "cleared", captionStatus: "unavailable", segments: [], changeReason: "Reviewed YouTube candidate.",
  });
}

describe("YouTube video candidate processing", () => {
  it("validates the immutable playable draft and reaches review_ready without generating evidence", async () => {
    const draft = videoDraft();
    let current: ContentCandidateRecord = {
      id: "00000000-0000-4000-8000-000000000861", sourceId: "00000000-0000-4000-8000-000000000862", externalItemId: draft.platformVideoId,
      normalizedUrl: draft.canonicalUrl, title: draft.title, contentType: "video", language: "es", publishedAt: new Date(draft.publicationDate), contentHash: draft.contentHash,
      metadata: { videoDraft: draft }, status: "discovered", rightsStatus: "verified", generationId: "generation-1", revision: 1, lastActivityAt: new Date(), rejectedAt: null,
      publicationStatus: "draft", publicationRef: null, publishedCandidateRevision: null, publishedContentHash: null, publishedAtInternal: null, archivedAt: null,
    };
    const recordProcessingAttempt = vi.fn(async () => undefined);
    const repository = {
      findCandidateById: vi.fn(async () => current),
      compareAndSwapCandidate: vi.fn(async (input) => {
        current = { ...current, status: input.status, revision: input.expectedRevision + 1, lastActivityAt: input.updatedAt };
        return current;
      }),
      recordProcessingAttempt,
    } as unknown as ContentAcquisitionRepository;

    await expect(prepareVideoCandidateForReview(repository, current.id, {
      makeAttemptId: () => "00000000-0000-4000-8000-000000000863",
      now: () => new Date("2026-09-13T11:00:00.000Z"),
    })).resolves.toMatchObject({ status: "review_ready", revision: 5 });
    expect(recordProcessingAttempt).toHaveBeenCalledWith(expect.objectContaining({ jobType: "youtube-metadata-normalization", status: "succeeded", estimatedCostMicros: 0 }));
  });

  it("rejects caption labels without a matching reviewed timeline", async () => {
    const draft = { ...videoDraft(), captionStatus: "platform_auto", segments: [] };
    const candidate = { contentType: "video", language: "es", rightsStatus: "verified", metadata: { videoDraft: draft } } as unknown as ContentCandidateRecord;
    const repository = { findCandidateById: vi.fn(async () => candidate) } as unknown as ContentAcquisitionRepository;
    await expect(prepareVideoCandidateForReview(repository, "candidate")).rejects.toThrow("caption state");
  });
});
