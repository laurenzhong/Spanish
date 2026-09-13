// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createPodcastCandidateDraft,
  preparePodcastCandidateForReview,
  type ContentAcquisitionRepository,
  type ContentCandidateRecord,
} from "@/src/modules/content-acquisition";

function podcastDraft() {
  return createPodcastCandidateDraft({
    stableKey: "podcast.episode42", feedUrl: "https://podcast.example.test/feed.xml", episodeGuid: "episode-42",
    canonicalUrl: "https://podcast.example.test/episodes/42", enclosureUrl: "https://media.example.test/42.mp3",
    enclosureMimeType: "audio/mpeg", enclosureByteSize: 128, playbackExpiresAt: "2026-09-21T10:00:00.000Z",
    title: "Una mañana en el mercado", summary: "Una charla breve.", sourceName: "Café de cada día", language: "es",
    region: "es-ES", cefr: "A2", topics: ["topic.daily-life"], durationMs: 360_000,
    publicationDate: "2026-09-13T08:00:00.000Z", fetchedAt: "2026-09-14T10:00:00.000Z", license: "licensed",
    attribution: "Café de cada día", licenseEvidence: "https://podcast.example.test/license", copyrightStatus: "cleared",
    transcriptStatus: "unavailable", transcriptUrl: null, segments: [], changeReason: "Reviewed podcast candidate.",
  });
}

describe("podcast candidate processing", () => {
  it("validates immutable playback metadata and reaches review_ready without evidence or ASR", async () => {
    const draft = podcastDraft();
    let current: ContentCandidateRecord = {
      id: "00000000-0000-4000-8000-000000000921", sourceId: "00000000-0000-4000-8000-000000000922",
      externalItemId: draft.episodeGuid, normalizedUrl: draft.canonicalUrl, title: draft.title, contentType: "podcast", language: "es",
      publishedAt: new Date(draft.publicationDate), contentHash: draft.contentHash, metadata: { podcastDraft: draft }, status: "discovered",
      rightsStatus: "verified", generationId: "generation-1", revision: 1, lastActivityAt: new Date(), rejectedAt: null,
      publicationStatus: "draft", publicationRef: null, publishedCandidateRevision: null, publishedContentHash: null,
      publishedAtInternal: null, archivedAt: null,
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

    await expect(preparePodcastCandidateForReview(repository, current.id, {
      makeAttemptId: () => "00000000-0000-4000-8000-000000000923",
      now: () => new Date("2026-09-14T11:00:00.000Z"),
    })).resolves.toMatchObject({ status: "review_ready", revision: 5 });
    expect(recordProcessingAttempt).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "podcast-metadata-normalization", status: "succeeded", estimatedCostMicros: 0,
    }));
    expect(recordProcessingAttempt).not.toHaveBeenCalledWith(expect.objectContaining({ jobType: expect.stringMatching(/asr/iu) }));
  });

  it("rejects transcript labels without a matching reviewed timeline", async () => {
    const draft = { ...podcastDraft(), transcriptStatus: "platform_auto", transcriptUrl: null, segments: [] };
    const candidate = { contentType: "podcast", language: "es", rightsStatus: "verified", metadata: { podcastDraft: draft } } as unknown as ContentCandidateRecord;
    const repository = { findCandidateById: vi.fn(async () => candidate) } as unknown as ContentAcquisitionRepository;
    await expect(preparePodcastCandidateForReview(repository, "candidate")).rejects.toThrow("transcript state");
  });
});
