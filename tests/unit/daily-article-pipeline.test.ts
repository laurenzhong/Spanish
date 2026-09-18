import { describe, expect, it, vi } from "vitest";

import { runDailyArticlePipeline } from "@/src/modules/content-acquisition/application/run-daily-article-pipeline";
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
    commitDiscoveryPage: vi.fn(async () => ({ inserted: 0, duplicates: 0, conflicts: 0, insertedCandidateIds: [] })),
    completeRun: vi.fn(async () => undefined),
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
});
