import { describe, expect, it } from "vitest";
import { planContentPipelineSources, ContentPipelineScheduleError } from "@/src/modules/content-acquisition";
import type { ContentSourceRecord } from "@/src/modules/content-acquisition";

const source = (stableKey: string, enabled = true): ContentSourceRecord => ({
  id: `${stableKey}-id`, stableKey, adapterType: "article-rss", sourceKind: "article-feed",
  externalSourceId: stableKey, displayName: stableKey, language: "es", region: "es-ES", enabled,
  rightsStatus: "verified", cursor: null, revision: 1,
});

describe("content pipeline scheduler", () => {
  it("selects enabled sources deterministically and supports an explicit source", () => {
    expect(planContentPipelineSources({ sources: [source("z-source"), source("a-source"), source("off", false)], limit: 2 }))
      .toEqual([
        { sourceStableKey: "a-source", adapterType: "article-rss", limit: 2 },
        { sourceStableKey: "z-source", adapterType: "article-rss", limit: 2 },
      ]);
    expect(planContentPipelineSources({ sources: [source("z-source")], sourceStableKey: "z-source", limit: 1 }))
      .toEqual([{ sourceStableKey: "z-source", adapterType: "article-rss", limit: 1 }]);
  });

  it("fails closed for missing, disabled and empty source plans", () => {
    expect(() => planContentPipelineSources({ sources: [], limit: 1 })).toThrow(ContentPipelineScheduleError);
    expect(() => planContentPipelineSources({ sources: [source("off", false)], limit: 1 })).toThrow(ContentPipelineScheduleError);
    expect(() => planContentPipelineSources({ sources: [source("off", false)], sourceStableKey: "off", limit: 1 })).toThrow(ContentPipelineScheduleError);
  });
});
