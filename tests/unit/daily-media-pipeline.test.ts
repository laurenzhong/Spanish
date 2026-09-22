import { describe, expect, it, vi } from "vitest";

import { hasBilingualSubtitleTimeline, runDailyMediaPipeline } from "@/src/modules/content-acquisition/application/run-daily-media-pipeline";
import { createVideoCandidateDraft } from "@/src/modules/content-acquisition/normalizers";
import { mediaReviewInputHash, type MediaReviewInput } from "@/src/modules/content-acquisition/providers/media-review";
import { CandidatePublisherRegistry } from "@/src/modules/content-acquisition/publishers";
import type { ContentCandidateRecord, ContentSourceRecord } from "@/src/modules/content-acquisition/repositories";

function source(overrides: Partial<ContentSourceRecord> = {}): ContentSourceRecord {
  return {
    id: "source-video",
    stableKey: "youtube.demo",
    adapterType: "youtube",
    sourceKind: "video-channel",
    externalSourceId: "UCdemo",
    displayName: "Demo",
    language: "es",
    region: "ES",
    enabled: true,
    rightsStatus: "verified",
    cursor: null,
    revision: 1,
    ...overrides,
  };
}

function repository(sources: readonly ContentSourceRecord[]) {
  return {
    listSources: vi.fn(async () => sources),
    findSourceByStableKey: vi.fn(async (stableKey: string) => sources.find((item) => item.stableKey === stableKey) ?? null),
    createRun: vi.fn(async () => undefined),
    commitDiscoveryPage: vi.fn(async () => ({ inserted: 0, duplicates: 0, conflicts: 0, insertedCandidateIds: [] as string[] })),
    completeRun: vi.fn(async () => undefined),
    listCandidates: vi.fn(async (input?: unknown): Promise<ContentCandidateRecord[]> => { void input; return []; }),
    findCandidateById: vi.fn(async (candidateId: string): Promise<ContentCandidateRecord | null> => { void candidateId; return null; }),
    compareAndSwapCandidate: vi.fn(async (input: unknown): Promise<ContentCandidateRecord | null> => { void input; return null; }),
    recordProcessingAttempt: vi.fn(async () => undefined),
    getCandidateReview: vi.fn(async (candidateId: string): Promise<unknown> => { void candidateId; return null; }),
    saveCandidateReview: vi.fn(async (input: unknown) => input),
    markCandidatePublished: vi.fn(async () => undefined),
  };
}

describe("runDailyMediaPipeline", () => {
  it("recognizes only complete Spanish-Chinese subtitle timelines", () => {
    const base = { contentType: "video" as const, metadata: { videoDraft: { segments: [{ sourceText: "Hola", translation: "你好" }] } } };
    expect(hasBilingualSubtitleTimeline(base)).toBe(true);
    expect(hasBilingualSubtitleTimeline({ ...base, metadata: { videoDraft: { segments: [{ sourceText: "Hola", translation: null }] } } })).toBe(false);
    expect(hasBilingualSubtitleTimeline({ ...base, metadata: { videoDraft: { segments: [] } } })).toBe(false);
  });

  it("fails closed for disabled mode and ignores unverified media sources", async () => {
    const repo = repository([
      source(),
      source({ id: "source-unverified", stableKey: "podcast.unverified", adapterType: "podcast-rss", sourceKind: "podcast-feed", rightsStatus: "unknown" }),
    ]);
    const resolveAdapter = vi.fn();
    const result = await runDailyMediaPipeline({ repository: repo as never, resolveAdapter }, { mode: "disabled", dailyLimit: 50, defaultSourceLimit: 10, date: "2026-09-19" });
    expect(result).toMatchObject({ runKey: "media-daily:2026-09-19", mode: "disabled", discovered: 0 });
    expect(result.skippedSources).toEqual([{ sourceStableKey: "podcast.unverified", reason: "RIGHTS_NOT_VERIFIED" }]);
    expect(resolveAdapter).not.toHaveBeenCalled();
    expect(repo.createRun).not.toHaveBeenCalled();
  });

  it("does not exceed the per-type target when the natural day is already complete", async () => {
    const repo = repository([source()]) as ReturnType<typeof repository> & { countPublishedMediaByType: ReturnType<typeof vi.fn> };
    repo.countPublishedMediaByType = vi.fn(async () => ({ video: 10, podcast: 10 }));
    const resolveAdapter = vi.fn();
    const result = await runDailyMediaPipeline({ repository: repo as never, resolveAdapter }, {
      mode: "discover-only",
      dailyLimit: 20,
      videoDailyLimit: 10,
      podcastDailyLimit: 10,
      defaultSourceLimit: 10,
      date: "2026-09-19",
    });
    expect(resolveAdapter).not.toHaveBeenCalled();
    expect(result).toMatchObject({ publishedByType: { video: 10, podcast: 10 }, targetDeficitByType: { video: 0, podcast: 0 } });
  });

  it("runs discovery in discover-only mode and keeps media unpublished", async () => {
    const repo = repository([source()]);
    const result = await runDailyMediaPipeline({
      repository: repo as never,
      resolveAdapter: async () => ({
        key: "youtube",
        discover: async () => ({ sourceStableKey: "youtube.demo", cursor: null, nextCursor: null, estimatedCostMicros: 0, items: [] }),
      }),
    }, { mode: "discover-only", dailyLimit: 1, defaultSourceLimit: 10, date: "2026-09-19" });
    expect(result).toMatchObject({ mode: "discover-only", discovered: 0, inserted: 0, prepared: 0, reviewReady: 0 });
    expect(repo.createRun).toHaveBeenCalledOnce();
    expect(repo.completeRun).toHaveBeenCalledOnce();
  });

  it("includes verified Language Reactor video and podcast sources without granting publication", async () => {
    const languageReactor = source({ adapterType: "language-reactor", sourceKind: "podcast-feed", stableKey: "language-reactor.podcast-mix-es" });
    const repo = repository([languageReactor]);
    const resolveAdapter = vi.fn(async () => ({
      key: "language-reactor" as const,
      discover: async () => ({ sourceStableKey: languageReactor.stableKey, cursor: null, nextCursor: null, estimatedCostMicros: 0, items: [] }),
    }));

    const result = await runDailyMediaPipeline({ repository: repo as never, resolveAdapter }, { mode: "discover-only", dailyLimit: 1, defaultSourceLimit: 1, date: "2026-09-19" });

    expect(resolveAdapter).toHaveBeenCalledWith(languageReactor);
    expect(result).toMatchObject({ mode: "discover-only", reviewReady: 0, prepared: 0 });
  });

  it("processes verified video sources before podcasts", async () => {
    const podcast = source({ id: "source-podcast", stableKey: "aaa.podcast", adapterType: "podcast-rss", sourceKind: "podcast-feed" });
    const video = source({ id: "source-video-priority", stableKey: "zzz.video" });
    const repo = repository([podcast, video]);
    const calls: string[] = [];
    const result = await runDailyMediaPipeline({
      repository: repo as never,
      resolveAdapter: async (item) => {
        calls.push(item.stableKey);
        return { key: item.sourceKind === "video-channel" ? "youtube" : "podcast-rss", discover: async () => ({ sourceStableKey: item.stableKey, cursor: null, nextCursor: null, estimatedCostMicros: 0, items: [] }) };
      },
    }, { mode: "discover-only", dailyLimit: 2, defaultSourceLimit: 1, date: "2026-09-19" });

    expect(result.failures).toEqual([]);
    expect(calls).toEqual([video.stableKey, podcast.stableKey]);
  });

  it("prefers the authorized Language Reactor directories within each media type", async () => {
    const genericVideo = source({ id: "source-generic-video", stableKey: "aaa.video" });
    const languageReactorVideo = source({
      id: "source-language-reactor-video",
      stableKey: "zzz.language-reactor-video",
      adapterType: "language-reactor",
      externalSourceId: "t_yt_mix_es",
    });
    const genericPodcast = source({ id: "source-generic-podcast", stableKey: "aaa.podcast", adapterType: "podcast-rss", sourceKind: "podcast-feed" });
    const languageReactorPodcast = source({
      id: "source-language-reactor-podcast",
      stableKey: "zzz.language-reactor-podcast",
      adapterType: "language-reactor",
      sourceKind: "podcast-feed",
      externalSourceId: "t_pd_mix_es",
    });
    const repo = repository([genericPodcast, genericVideo, languageReactorPodcast, languageReactorVideo]);
    const calls: string[] = [];
    const result = await runDailyMediaPipeline({
      repository: repo as never,
      resolveAdapter: async (item) => {
        calls.push(item.stableKey);
        return { key: item.adapterType === "language-reactor" ? "language-reactor" : item.sourceKind === "video-channel" ? "youtube" : "podcast-rss", discover: async () => ({ sourceStableKey: item.stableKey, cursor: null, nextCursor: null, estimatedCostMicros: 0, items: [] }) };
      },
    }, { mode: "discover-only", dailyLimit: 4, defaultSourceLimit: 1, date: "2026-09-19" });

    expect(result.failures).toEqual([]);
    expect(calls).toEqual([
      languageReactorVideo.stableKey,
      genericVideo.stableKey,
      languageReactorPodcast.stableKey,
      genericPodcast.stableKey,
    ]);
  });

  it("times out a stalled source and continues with the next authorized source", async () => {
    const stalled = source({ id: "source-stalled", stableKey: "aaa.stalled" });
    const healthy = source({ id: "source-healthy", stableKey: "bbb.healthy" });
    const repo = repository([stalled, healthy]);
    const calls: string[] = [];
    const result = await runDailyMediaPipeline({
      repository: repo as never,
      resolveAdapter: async (item) => {
        calls.push(item.stableKey);
        if (item.id === stalled.id) {
          return {
            key: "youtube" as const,
            discover: async (_input: unknown, options?: Readonly<{ signal?: AbortSignal }>) => new Promise<never>((_resolve, reject) => {
              options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            }),
          };
        }
        return {
          key: "youtube" as const,
          discover: async () => ({ sourceStableKey: healthy.stableKey, cursor: null, nextCursor: null, estimatedCostMicros: 0, items: [] }),
        };
      },
    }, { mode: "discover-only", dailyLimit: 2, defaultSourceLimit: 1, sourceTimeoutMs: 5, date: "2026-09-19" });

    expect(calls).toEqual([stalled.stableKey, healthy.stableKey]);
    expect(result.failures).toEqual([{ scope: "source", sourceStableKey: stalled.stableKey, code: "MEDIA_SOURCE_TIMEOUT" }]);
    expect(repo.createRun).toHaveBeenCalledTimes(2);
  });

  it("reviews candidates in bounded parallel batches", async () => {
    const mediaSource = source();
    const repo = repository([mediaSource]);
    const drafts = ["one", "two"].map((title) => createVideoCandidateDraft({
      stableKey: `youtube.demo.${title}`,
      platform: "youtube",
      platformVideoId: `${title}-id`,
      sourceChannelId: "UC1234567890123456789012",
      canonicalUrl: `https://www.youtube.com/watch?v=${title}-id`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${title}-id?enablejsapi=1`,
      title,
      summary: "Resumen",
      sourceName: "Demo",
      language: "es",
      region: "ES",
      cefr: "A2",
      topics: ["topic.media"],
      durationMs: 60_000,
      publicationDate: "2026-09-18T00:00:00.000Z",
      fetchedAt: "2026-09-19T00:00:00.000Z",
      license: "licensed",
      attribution: "Demo",
      licenseEvidence: "https://example.test/license",
      copyrightStatus: "cleared",
      captionStatus: "unavailable",
      segments: [],
      changeReason: "Daily discovery",
    }));
    const candidates: ContentCandidateRecord[] = drafts.map((draft, index) => ({
      id: `candidate-${index}`,
      sourceId: mediaSource.id,
      externalItemId: draft.platformVideoId,
      normalizedUrl: draft.canonicalUrl,
      title: draft.title,
      contentType: "video" as const,
      language: "es",
      metadata: { videoDraft: draft },
      publishedAt: null,
      contentHash: draft.contentHash,
      rightsStatus: "verified" as const,
      status: "review_ready" as const,
      revision: 1,
      generationId: "generation-1",
      lastActivityAt: new Date("2026-09-18T00:00:00.000Z"),
      rejectedAt: null,
      publicationStatus: "draft" as const,
      publicationRef: null,
      publishedCandidateRevision: null,
      publishedContentHash: null,
      publishedAtInternal: null,
      archivedAt: null,
    }));
    repo.listCandidates.mockImplementation(async (input: unknown) => {
      const query = input as { status?: string };
      return query.status === "review_ready" ? candidates : [];
    });
    repo.findCandidateById.mockImplementation(async (candidateId: string) => candidates.find((candidate) => candidate.id === candidateId) ?? null);
    repo.getCandidateReview.mockImplementation(async (candidateId: string) => {
      const candidate = candidates.find((item) => item.id === candidateId);
      return candidate ? { candidate, reviews: [] } : null;
    });
    const active = { count: 0, max: 0 };
    const providerReview = vi.fn(async (input: MediaReviewInput) => {
      active.count += 1;
      active.max = Math.max(active.max, active.count);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.count -= 1;
      return { decision: "approved" as const, notes: "ok", modelVersion: "test", inputHash: mediaReviewInputHash(input) };
    });
    const provider = {
      dimension: "content-es-ES" as const,
      review: providerReview,
    };
    const teaching = { ...provider, dimension: "teaching-zh-CN" as const };
    const result = await runDailyMediaPipeline({ repository: repo as never, resolveAdapter: async () => ({ key: "youtube", discover: async () => ({ sourceStableKey: mediaSource.stableKey, cursor: null, nextCursor: null, estimatedCostMicros: 0, items: [] }) }), reviewProviders: { content: provider, teaching } }, { mode: "review-only", dailyLimit: 2, defaultSourceLimit: 2, reviewConcurrency: 2, date: "2026-09-19" });

    expect(result.reviewed).toBe(2);
    expect(active.max).toBeGreaterThan(1);

    const approvals = ["content-es-ES", "teaching-zh-CN", "structure"].map((dimension, index) => ({
      id: `review-${index}`,
      candidateId: candidates[0]!.id,
      dimension: dimension as "content-es-ES" | "teaching-zh-CN" | "structure",
      status: "approved" as const,
      reviewerReference: "codex-ai-owner-authorized-review",
      candidateRevision: 1,
      notes: null,
    }));
    repo.getCandidateReview.mockImplementation(async (candidateId: string) => {
      const candidate = candidates.find((item) => item.id === candidateId);
      return candidate ? { candidate, reviews: approvals.map((review) => ({ ...review, candidateId })) } : null;
    });
    providerReview.mockClear();
    const hostedMetadata: Readonly<Record<string, unknown>> = { ...(candidates[0]!.metadata as Record<string, unknown>), bunnyVideoAsset: { providerKey: "bunny-storage", playbackUrl: "https://cdn.example/video.mp4", mimeType: "video/mp4", sha256: "a".repeat(64), byteSize: 123 } };
    candidates[0] = { ...candidates[0]!, metadata: hostedMetadata };
    const publisher = {
      contentType: "video" as const,
      publish: vi.fn(async () => ({ kind: "media" as const, stableKey: "youtube.demo.one", version: 1 })),
      archive: vi.fn(async () => undefined),
    };
    const resumed = await runDailyMediaPipeline({ repository: repo as never, resolveAdapter: async () => ({ key: "youtube", discover: async () => ({ sourceStableKey: mediaSource.stableKey, cursor: null, nextCursor: null, estimatedCostMicros: 0, items: [] }) }), reviewProviders: { content: provider, teaching }, publishers: new CandidatePublisherRegistry([publisher]) }, { mode: "auto-publish", dailyLimit: 2, defaultSourceLimit: 2, reviewConcurrency: 2, date: "2026-09-19" });
    expect(providerReview).not.toHaveBeenCalled();
    expect(resumed).toMatchObject({ published: 1, skipped: 1, failures: [] });
    expect(publisher.publish).toHaveBeenCalledOnce();
  });

  it("resumes partially processed candidates in review-only mode", async () => {
    const mediaSource = source();
    const repo = repository([mediaSource]);
    const draft = createVideoCandidateDraft({
      stableKey: "youtube.demo.video-1",
      platform: "youtube",
      platformVideoId: "video-1",
      sourceChannelId: "UC1234567890123456789012",
      canonicalUrl: "https://www.youtube.com/watch?v=video-1",
      embedUrl: "https://www.youtube-nocookie.com/embed/video-1?enablejsapi=1",
      title: "Una noticia breve",
      summary: "Resumen",
      sourceName: "Demo",
      language: "es",
      region: "ES",
      cefr: "A2",
      topics: ["topic.media"],
      durationMs: 60_000,
      publicationDate: "2026-09-18T00:00:00.000Z",
      fetchedAt: "2026-09-19T00:00:00.000Z",
      license: "licensed",
      attribution: "Demo",
      licenseEvidence: "https://example.test/license",
      copyrightStatus: "cleared",
      captionStatus: "unavailable",
      segments: [],
      changeReason: "Daily discovery",
    });
    const candidate = {
      id: "candidate-processing",
      sourceId: mediaSource.id,
      externalItemId: draft.platformVideoId,
      normalizedUrl: draft.canonicalUrl,
      title: draft.title,
      contentType: "video",
      language: "es",
      metadata: { videoDraft: draft },
      publishedAt: null,
      contentHash: draft.contentHash,
      rightsStatus: "verified",
      status: "processing",
      revision: 4,
      generationId: "generation-1",
      lastActivityAt: new Date("2026-09-18T00:00:00.000Z"),
      rejectedAt: null,
      publicationStatus: "draft",
      publicationRef: null,
      publishedCandidateRevision: null,
      publishedContentHash: null,
      publishedAtInternal: null,
      archivedAt: null,
    } satisfies ContentCandidateRecord;
    repo.listCandidates.mockImplementation(async (input: unknown) => {
      const query = input as { status?: string };
      return query.status === "processing" ? [candidate] : [];
    });
    repo.findCandidateById.mockResolvedValue(candidate);
    repo.compareAndSwapCandidate.mockImplementation(async (input: unknown) => ({
      ...candidate,
      status: (input as { status: ContentCandidateRecord["status"] }).status,
      revision: candidate.revision + 1,
    }));

    const result = await runDailyMediaPipeline({
      repository: repo as never,
      resolveAdapter: async () => ({
        key: "youtube",
        discover: async () => ({ sourceStableKey: mediaSource.stableKey, cursor: null, nextCursor: null, estimatedCostMicros: 0, items: [] }),
      }),
    }, { mode: "review-only", dailyLimit: 10, defaultSourceLimit: 10, date: "2026-09-19" });

    expect(repo.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ status: "processing", contentType: "video", publicationStatus: "draft" }));
    expect(result).toMatchObject({ prepared: 1, reviewReady: 1, failures: [] });
    expect(repo.compareAndSwapCandidate).toHaveBeenCalledWith(expect.objectContaining({ candidateId: candidate.id, status: "review_ready" }));
  });

  it("continues existing draft candidates when source discovery fails", async () => {
    const mediaSource = source();
    const repo = repository([mediaSource]);
    const candidate = createVideoCandidateDraft({
      stableKey: "youtube.discovery-failure-draft",
      platform: "youtube",
      platformVideoId: "discoveryFailure1",
      sourceChannelId: "UC1234567890123456789012",
      canonicalUrl: "https://www.youtube.com/watch?v=discoveryFailure1",
      embedUrl: "https://www.youtube-nocookie.com/embed/discoveryFailure1?enablejsapi=1",
      title: "Una conversación preparada",
      summary: "Resumen",
      sourceName: "Demo",
      language: "es",
      region: "ES",
      cefr: "A2",
      topics: ["topic.media"],
      durationMs: 60_000,
      publicationDate: "2026-09-18T00:00:00.000Z",
      fetchedAt: "2026-09-19T00:00:00.000Z",
      license: "licensed",
      attribution: "Demo",
      licenseEvidence: "https://example.test/license",
      copyrightStatus: "cleared",
      captionStatus: "platform_manual",
      segments: [{ index: 0, startMs: 0, endMs: 60_000, sourceText: "Hola.", translation: "你好。", speaker: null, confidence: null, sourceKind: "platform_manual" }],
      changeReason: "Prepared candidate.",
    });
    const candidateRecord = {
      id: "candidate-discovery-failure",
      sourceId: mediaSource.id,
      externalItemId: candidate.platformVideoId,
      normalizedUrl: candidate.canonicalUrl,
      title: candidate.title,
      contentType: "video",
      language: "es",
      metadata: { videoDraft: candidate, bunnyVideoAsset: { providerKey: "bunny-storage", playbackUrl: "https://sueno-media.b-cdn.net/media/x/video.mp4", mimeType: "video/mp4", sha256: "a".repeat(64), byteSize: 1 } },
      publishedAt: null,
      contentHash: candidate.contentHash,
      rightsStatus: "verified",
      status: "review_ready",
      revision: 1,
      generationId: "generation-1",
      lastActivityAt: new Date("2026-09-18T00:00:00.000Z"),
      rejectedAt: null,
      publicationStatus: "draft",
      publicationRef: null,
      publishedCandidateRevision: null,
      publishedContentHash: null,
      publishedAtInternal: null,
      archivedAt: null,
    } satisfies ContentCandidateRecord;
    repo.listCandidates.mockResolvedValue([candidateRecord]);
    repo.getCandidateReview.mockResolvedValue({ candidate: candidateRecord, reviews: [
      ...["content-es-ES", "teaching-zh-CN", "structure"].map((dimension) => ({ id: dimension, candidateId: candidateRecord.id, dimension, status: "approved", reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 1, notes: null })),
    ] } as never);
    const reviewProvider = {
      dimension: "content-es-ES" as const,
      review: vi.fn(async (input: MediaReviewInput) => ({ decision: "approved" as const, notes: "ok", modelVersion: "test", inputHash: mediaReviewInputHash(input) })),
    };
    const teachingProvider = { ...reviewProvider, dimension: "teaching-zh-CN" as const };
    const publisher = { contentType: "video" as const, publish: vi.fn(async () => ({ kind: "media" as const, stableKey: candidate.stableKey, version: 1 })), archive: vi.fn(async () => undefined) };
    const result = await runDailyMediaPipeline({
      repository: repo as never,
      resolveAdapter: async () => ({ key: "youtube", discover: async () => { throw new Error("temporary discovery failure"); } }),
      reviewProviders: { content: reviewProvider, teaching: teachingProvider },
      publishers: new CandidatePublisherRegistry([publisher]),
    }, { mode: "auto-publish", dailyLimit: 1, videoDailyLimit: 1, podcastDailyLimit: 0, defaultSourceLimit: 1, date: "2026-09-19" });

    expect(result.published).toBe(1);
    expect(result.failures).toEqual([{ scope: "source", sourceStableKey: mediaSource.stableKey, code: "temporary_discovery_failure" }]);
    expect(publisher.publish).toHaveBeenCalledOnce();
  });
});
