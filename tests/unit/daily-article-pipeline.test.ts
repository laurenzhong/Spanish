import { describe, expect, it, vi } from "vitest";

import { runDailyArticlePipeline } from "@/src/modules/content-acquisition/application/run-daily-article-pipeline";
import { normalizeArticleCandidate } from "@/src/modules/content-acquisition/normalizers";
import { createDefaultArticleReviewProviders } from "@/src/modules/content-acquisition/providers/article-review";
import type { ContentCandidateRecord } from "@/src/modules/content-acquisition/repositories";
import type { ContentSourceRecord } from "@/src/modules/content-acquisition/repositories";

function source(stableKey: string): ContentSourceRecord {
  return {
    id: `${stableKey}-id`,
    stableKey,
    adapterType: "article-rss",
    sourceKind: "article-feed",
    externalSourceId: `https://feed.example.test/${stableKey}`,
    displayName: stableKey,
    language: "es",
    region: "ES",
    enabled: true,
    rightsStatus: "verified",
    rightsPolicy: {
      automatedPublication: {
        enabled: true,
        policyVersion: "p1",
        approvedAt: "2026-09-18T00:00:00.000Z",
        dailyLimit: 10,
      },
    },
    cursor: null,
    revision: 1,
  };
}

function repository(sources: readonly ContentSourceRecord[]) {
  return {
    listSources: vi.fn(async () => sources),
    findSourceByStableKey: vi.fn(async (stableKey: string) => sources.find((item) => item.stableKey === stableKey) ?? null),
    createRun: vi.fn(async () => undefined),
    commitDiscoveryPage: vi.fn(async (input: unknown) => { void input; return { inserted: 0, duplicates: 0, conflicts: 0, insertedCandidateIds: [] as string[] }; }),
    completeRun: vi.fn(async () => undefined),
    listCandidates: vi.fn(async (input: unknown) => { void input; return [] as ContentCandidateRecord[]; }),
    findCandidateById: vi.fn(async (candidateId: string) => { void candidateId; return null as ContentCandidateRecord | null; }),
    compareAndSwapCandidate: vi.fn(async (input: unknown) => { void input; return null as ContentCandidateRecord | null; }),
    recordProcessingAttempt: vi.fn(async () => undefined),
    getCandidateReview: vi.fn(async (candidateId: string) => { void candidateId; return null as unknown; }),
    saveCandidateReview: vi.fn(async (input: unknown) => input),
  };
}

describe("runDailyArticlePipeline", () => {
  it("enforces the global quota and keeps discover-only free of review/publish work", async () => {
    const sources = [source("alpha"), source("beta")];
    const repo = repository(sources);
    const calls: string[] = [];
    const result = await runDailyArticlePipeline({
      repository: repo as never,
      resolveAdapter: async (item) => {
        calls.push(item.stableKey);
        return {
          key: "article-rss",
          discover: async (input) => ({ sourceStableKey: input.sourceStableKey, cursor: input.cursor, nextCursor: null, estimatedCostMicros: 0, items: [] }),
        };
      },
    }, {
      date: "2026-09-18",
      mode: "discover-only",
      policyVersion: "p1",
      dailyLimit: 1,
      defaultSourceLimit: 10,
    });

    expect(result).toMatchObject({ mode: "discover-only", discovered: 0, inserted: 0 });
    expect(calls).toEqual(["alpha"]);
    expect(repo.createRun).toHaveBeenCalledOnce();
  });

  it("does not write when disabled", async () => {
    const repo = repository([source("alpha")]);
    const resolveAdapter = vi.fn();
    const result = await runDailyArticlePipeline({ repository: repo as never, resolveAdapter }, {
      date: "2026-09-18",
      mode: "disabled",
      policyVersion: "",
      dailyLimit: 50,
      defaultSourceLimit: 10,
    });

    expect(result.mode).toBe("disabled");
    expect(resolveAdapter).not.toHaveBeenCalled();
    expect(repo.createRun).not.toHaveBeenCalled();
  });

  it("reviews pending candidates from an earlier discover-only run", async () => {
    const sources = [source("alpha")];
    const repo = repository(sources);
    const item = normalizeArticleCandidate({
      sourceStableKey: "alpha",
      externalItemId: "article-1",
      canonicalUrl: "https://news.example.test/article-1",
      title: "Una noticia breve",
      summary: "Un resumen breve.",
      author: null,
      publishedAt: null,
      fetchedAt: "2026-09-18T00:00:00.000Z",
      paragraphs: ["El texto de la noticia."],
      source: { sourceName: "Alpha", sourceType: "licensed", license: "licensed", attribution: "Alpha", licenseEvidence: "https://news.example.test/license" },
      defaults: { cefr: "B1", topics: ["daily-life"], region: "ES", register: "neutral", format: "news", oralTransferType: "summary" },
    });
    let current: ContentCandidateRecord | null = null;
    const savedReviews: unknown[] = [];
    repo.commitDiscoveryPage.mockImplementation(async (rawInput) => {
      const input = rawInput as {
        sourceId: string;
        candidates: readonly [{
          id: string;
          externalItemId: string;
          normalizedUrl: string;
          title: string;
          contentHash: string | null;
          metadata: Readonly<Record<string, unknown>>;
          generationId: string;
          discoveredAt: Date;
        }];
      };
      if (!input.candidates[0]) return { inserted: 0, duplicates: 0, conflicts: 0, insertedCandidateIds: [] };
      current = {
        id: input.candidates[0]!.id,
        sourceId: input.sourceId,
        externalItemId: input.candidates[0]!.externalItemId,
        normalizedUrl: input.candidates[0]!.normalizedUrl,
        title: input.candidates[0]!.title,
        contentType: "article",
        language: "es",
        publishedAt: null,
        contentHash: input.candidates[0]!.contentHash,
        metadata: input.candidates[0]!.metadata,
        status: "discovered",
        rightsStatus: "verified",
        generationId: input.candidates[0]!.generationId,
        revision: 1,
        lastActivityAt: input.candidates[0]!.discoveredAt,
        rejectedAt: null,
        publicationStatus: "draft",
        publicationRef: null,
        publishedCandidateRevision: null,
        publishedContentHash: null,
        publishedAtInternal: null,
        archivedAt: null,
      };
      return { inserted: 1, duplicates: 0, conflicts: 0, insertedCandidateIds: [current.id] };
    });
    repo.listCandidates.mockImplementation(async (rawInput) => {
      const input = rawInput as { status?: string };
      return current && current.status === input.status ? [current] : [];
    });
    repo.findCandidateById.mockImplementation(async () => current);
    repo.getCandidateReview.mockImplementation(async () => current ? ({ candidate: current, source: sources[0]!, artifacts: [], attempts: [], reviews: savedReviews }) as never : null);
    repo.compareAndSwapCandidate.mockImplementation(async (rawInput) => {
      const input = rawInput as { status: ContentCandidateRecord["status"]; expectedRevision: number; updatedAt: Date };
      if (!current) throw new Error("candidate missing");
      current = { ...current, status: input.status, revision: input.expectedRevision + 1, lastActivityAt: input.updatedAt };
      return current;
    });
    repo.recordProcessingAttempt.mockResolvedValue(undefined);
    repo.saveCandidateReview.mockImplementation(async (input) => {
      savedReviews.push(input);
      return input as never;
    });
    const resolveAdapter = vi.fn(async () => ({
      key: "article-rss" as const,
      discover: async (input: { sourceStableKey: string; cursor: string | null; limit: number }) => ({
        sourceStableKey: input.sourceStableKey,
        cursor: input.cursor,
        nextCursor: input.cursor,
        estimatedCostMicros: 0,
        items: input.limit > 0 && !current ? [{ ...item, publishedAt: null }] : [],
      }),
    }));
    const dependencies = {
      repository: repo as never,
      resolveAdapter,
      reviewProviders: createDefaultArticleReviewProviders(),
    };
    await runDailyArticlePipeline(dependencies, { date: "2026-09-17", mode: "discover-only", policyVersion: "p1", dailyLimit: 10, defaultSourceLimit: 10 });
    const result = await runDailyArticlePipeline(dependencies, { date: "2026-09-18", mode: "review-only", policyVersion: "p1", dailyLimit: 10, defaultSourceLimit: 10 });

    expect(repo.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ sourceId: sources[0]!.id, status: "review_ready", contentType: "article" }));
    expect(result.prepared).toBe(1);
    expect(result.reviewed).toBe(1);
    expect(result.approved).toBe(1);
    expect(savedReviews).toHaveLength(3);
  });
});
