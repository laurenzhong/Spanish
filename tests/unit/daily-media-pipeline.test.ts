import { describe, expect, it, vi } from "vitest";

import { runDailyMediaPipeline } from "@/src/modules/content-acquisition/application/run-daily-media-pipeline";
import { createVideoCandidateDraft } from "@/src/modules/content-acquisition/normalizers";
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
    getCandidateReview: vi.fn(async () => null),
    saveCandidateReview: vi.fn(async (input: unknown) => input),
  };
}

describe("runDailyMediaPipeline", () => {
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

    expect(repo.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ status: "processing", contentType: "video" }));
    expect(result).toMatchObject({ prepared: 1, reviewReady: 1, failures: [] });
    expect(repo.compareAndSwapCandidate).toHaveBeenCalledWith(expect.objectContaining({ candidateId: candidate.id, status: "review_ready" }));
  });
});
