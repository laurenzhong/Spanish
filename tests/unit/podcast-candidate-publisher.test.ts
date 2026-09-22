// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  AcquiredPodcastPublisher,
  PodcastPublicationConflictError,
  createPodcastCandidateDraft,
} from "@/src/modules/content-acquisition";
import type { AcquiredPodcastRepository } from "@/src/modules/media";
import { contentWorkflowPublishers } from "@/src/modules/content-acquisition/publishers/runtime-registry";

function draft() {
  return createPodcastCandidateDraft({
    stableKey: "podcast.episode42", feedUrl: "https://podcast.example.test/feed.xml", episodeGuid: "episode-42",
    canonicalUrl: "https://podcast.example.test/episodes/42", enclosureUrl: "https://media.example.test/42.mp3",
    enclosureMimeType: "audio/mpeg", enclosureByteSize: 128, playbackExpiresAt: "2026-09-21T10:00:00.000Z",
    title: "Una mañana en el mercado", summary: "Una charla breve.", sourceName: "Café de cada día", language: "es",
    region: "es-ES", cefr: "A2", topics: ["topic.daily-life"], durationMs: 360_000,
    publicationDate: "2026-09-13T08:00:00.000Z", fetchedAt: "2026-09-14T10:00:00.000Z", license: "licensed",
    attribution: "Café de cada día", licenseEvidence: "https://podcast.example.test/license", copyrightStatus: "cleared",
    transcriptStatus: "platform_manual", transcriptUrl: "https://transcripts.example.test/42.vtt",
    segments: [{ index: 0, startMs: 0, endMs: 2_200, sourceText: "Buenos días.", translation: null, speaker: null, confidence: null, sourceKind: "platform_manual" }],
    changeReason: "Reviewed podcast candidate.",
  });
}

const reviews = [
  { id: "r-es", candidateId: "candidate-1", dimension: "content-es-ES" as const, status: "approved" as const, reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: "Contenido revisado." },
  { id: "r-zh", candidateId: "candidate-1", dimension: "teaching-zh-CN" as const, status: "approved" as const, reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: "教学说明已复核。" },
  { id: "r-structure", candidateId: "candidate-1", dimension: "structure" as const, status: "approved" as const, reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: null },
];

describe("acquired podcast publisher", () => {
  it("is registered for the owner publication workflow", () => {
    expect(contentWorkflowPublishers.has("podcast")).toBe(true);
  });

  it("passes the immutable reviewed episode and current review records to media", async () => {
    const podcast = draft();
    const publishAcquiredPodcast = vi.fn(async () => ({ kind: "media" as const, stableKey: podcast.stableKey, version: 1 }));
    const repository = { publishAcquiredPodcast, archiveAcquiredPodcast: vi.fn() } as unknown as AcquiredPodcastRepository;
    const publisher = new AcquiredPodcastPublisher(repository, { now: () => new Date("2026-09-14T11:00:00.000Z") });

    await expect(publisher.publish({
      candidateId: "candidate-1", candidateRevision: 5, contentHash: podcast.contentHash, contentType: "podcast",
      title: podcast.title, language: podcast.language, normalizedUrl: podcast.canonicalUrl,
      metadata: { podcastDraft: podcast }, reviews,
    })).resolves.toEqual({ kind: "media", stableKey: podcast.stableKey, version: 1 });
    expect(publishAcquiredPodcast).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: "candidate-1", candidateRevision: 5, draft: podcast,
      reviews: [expect.objectContaining({ locale: "es-ES" }), expect.objectContaining({ locale: "zh-CN" })],
    }));
  });

  it("rejects stale fields, expired playback validation, and mismatched transcript state", async () => {
    const podcast = draft();
    const publishAcquiredPodcast = vi.fn();
    const publisher = new AcquiredPodcastPublisher({ publishAcquiredPodcast, archiveAcquiredPodcast: vi.fn() } as unknown as AcquiredPodcastRepository, {
      now: () => new Date("2026-09-14T11:00:00.000Z"),
    });
    const input = { candidateId: "candidate-1", candidateRevision: 5, contentHash: podcast.contentHash, contentType: "podcast" as const, title: podcast.title, language: podcast.language, normalizedUrl: podcast.canonicalUrl, metadata: { podcastDraft: podcast }, reviews };

    await expect(publisher.publish({ ...input, title: "Changed" })).rejects.toBeInstanceOf(PodcastPublicationConflictError);
    await expect(publisher.publish({ ...input, reviews: reviews.map((review) => ({ ...review, candidateRevision: 4 })) })).rejects.toBeInstanceOf(PodcastPublicationConflictError);
    await expect(publisher.publish({ ...input, metadata: { podcastDraft: { ...podcast, playbackExpiresAt: "2026-09-14T10:30:00.000Z" } } })).rejects.toBeInstanceOf(PodcastPublicationConflictError);
    await expect(publisher.publish({ ...input, metadata: { podcastDraft: { ...podcast, transcriptUrl: null } } })).rejects.toBeInstanceOf(PodcastPublicationConflictError);
    expect(publishAcquiredPodcast).not.toHaveBeenCalled();
  });

  it("rejects an otherwise approved podcast when the daily bilingual gate is enabled", async () => {
    const podcast = createPodcastCandidateDraft({ ...draft(), transcriptStatus: "unavailable", transcriptUrl: null, segments: [] });
    const publisher = new AcquiredPodcastPublisher({ publishAcquiredPodcast: vi.fn(), archiveAcquiredPodcast: vi.fn() } as unknown as AcquiredPodcastRepository);
    await expect(publisher.publish({
      candidateId: "candidate-1", candidateRevision: 5, contentHash: podcast.contentHash, contentType: "podcast",
      title: podcast.title, language: podcast.language, normalizedUrl: podcast.canonicalUrl, metadata: { podcastDraft: podcast }, reviews,
      requireBilingualSubtitles: true,
    })).rejects.toBeInstanceOf(PodcastPublicationConflictError);
  });
});
