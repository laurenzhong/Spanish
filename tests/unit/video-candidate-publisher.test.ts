// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  AcquiredVideoPublisher,
  VideoPublicationConflictError,
  createVideoCandidateDraft,
} from "@/src/modules/content-acquisition";
import type { AcquiredVideoRepository } from "@/src/modules/media";

function draft() {
  return createVideoCandidateDraft({
    stableKey: "youtube.publicvideo1",
    platform: "youtube",
    platformVideoId: "publicVideo1",
    sourceChannelId: "UCabcdefghijklmnopqrstuv",
    canonicalUrl: "https://www.youtube.com/watch?v=publicVideo1",
    embedUrl: "https://www.youtube-nocookie.com/embed/publicVideo1?enablejsapi=1",
    title: "Cómo pedir un café",
    summary: "Una conversación breve.",
    sourceName: "Español con calma",
    language: "es",
    region: "es-ES",
    cefr: "A2",
    topics: ["topic.daily-life"],
    durationMs: 245_000,
    publicationDate: "2026-09-13T08:00:00.000Z",
    fetchedAt: "2026-09-13T10:00:00.000Z",
    license: "licensed",
    attribution: "Español con calma en YouTube",
    licenseEvidence: "https://www.youtube.com/t/terms",
    copyrightStatus: "cleared",
    captionStatus: "platform_manual",
    segments: [{ index: 0, startMs: 0, endMs: 1_800, sourceText: "Buenos días.", translation: "早上好。", speaker: null, confidence: null, sourceKind: "platform_manual" }],
    changeReason: "Reviewed YouTube candidate.",
  });
}

const reviews = [
  { id: "r-es", candidateId: "candidate-1", dimension: "content-es-ES" as const, status: "approved" as const, reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: "Contenido revisado." },
  { id: "r-zh", candidateId: "candidate-1", dimension: "teaching-zh-CN" as const, status: "approved" as const, reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: "教学说明已复核。" },
  { id: "r-structure", candidateId: "candidate-1", dimension: "structure" as const, status: "approved" as const, reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: null },
];

describe("acquired YouTube video publisher", () => {
  it("passes the immutable reviewed video and two review records to media", async () => {
    const video = draft();
    const publishAcquiredVideo = vi.fn(async () => ({ kind: "media" as const, stableKey: video.stableKey, version: 1 }));
    const repository = { publishAcquiredVideo, archiveAcquiredVideo: vi.fn() } as unknown as AcquiredVideoRepository;
    const publisher = new AcquiredVideoPublisher(repository, { now: () => new Date("2026-09-13T11:00:00.000Z") });

    await expect(publisher.publish({
      candidateId: "candidate-1",
      candidateRevision: 5,
      contentHash: video.contentHash,
      contentType: "video",
      title: video.title,
      language: video.language,
      normalizedUrl: video.canonicalUrl,
      metadata: { videoDraft: video },
      reviews,
    })).resolves.toEqual({ kind: "media", stableKey: video.stableKey, version: 1 });
    expect(publishAcquiredVideo).toHaveBeenCalledWith(expect.objectContaining({
      candidateId: "candidate-1",
      candidateRevision: 5,
      draft: video,
      reviews: [expect.objectContaining({ locale: "es-ES" }), expect.objectContaining({ locale: "zh-CN" })],
    }));
  });

  it("rejects stale fields, review revisions, and unreviewed segment timelines", async () => {
    const video = draft();
    const publishAcquiredVideo = vi.fn();
    const publisher = new AcquiredVideoPublisher({ publishAcquiredVideo, archiveAcquiredVideo: vi.fn() } as unknown as AcquiredVideoRepository);
    const input = { candidateId: "candidate-1", candidateRevision: 5, contentHash: video.contentHash, contentType: "video" as const, title: video.title, language: video.language, normalizedUrl: video.canonicalUrl, metadata: { videoDraft: video }, reviews };

    await expect(publisher.publish({ ...input, title: "Changed" })).rejects.toBeInstanceOf(VideoPublicationConflictError);
    await expect(publisher.publish({ ...input, reviews: reviews.map((review) => ({ ...review, candidateRevision: 4 })) })).rejects.toBeInstanceOf(VideoPublicationConflictError);
    await expect(publisher.publish({ ...input, metadata: { videoDraft: { ...video, segments: [{ ...video.segments[0], endMs: 300_000 }] } } })).rejects.toBeInstanceOf(VideoPublicationConflictError);
    await expect(publisher.publish({ ...input, metadata: { videoDraft: { ...video, summary: "Changed without a new hash." } } })).rejects.toBeInstanceOf(VideoPublicationConflictError);
    await expect(publisher.publish({ ...input, metadata: { videoDraft: { ...video, embedUrl: `${video.embedUrl}-other` } } })).rejects.toBeInstanceOf(VideoPublicationConflictError);
    expect(publishAcquiredVideo).not.toHaveBeenCalled();
  });
});
