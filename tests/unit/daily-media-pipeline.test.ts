import { describe, expect, it, vi } from "vitest";

import { runDailyMediaPipeline } from "@/src/modules/content-acquisition/application/run-daily-media-pipeline";
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
    listCandidates: vi.fn(async () => [] as ContentCandidateRecord[]),
    findCandidateById: vi.fn(async () => null),
    compareAndSwapCandidate: vi.fn(async () => null),
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
});
