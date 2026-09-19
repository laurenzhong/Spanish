import { describe, expect, it } from "vitest";

import { buildKwic, contentSourceHref, matchesCorpusQuery, normalizeCorpusQuery } from "@/src/modules/lexicon-corpus/domain";

describe("corpus search", () => {
  it("normalizes accents and requires every query token", () => {
    expect(normalizeCorpusQuery("  Qué, tal  ")).toEqual(["que", "tal"]);
    expect(matchesCorpusQuery("¿Qué tal? Todo bien", ["que", "tal"])).toBe(true);
    expect(matchesCorpusQuery("Qué pasa", ["que", "tal"])).toBe(false);
  });

  it("builds bounded KWIC context without leaking unrelated fields", () => {
    expect(buildKwic({
      surfaceText: "Qué tal",
      contextBefore: "Hola",
      contextAfter: "amigo",
      sourceTitle: "Una charla",
      sourceKind: "media",
      documentKind: "media",
      documentStableKey: "media.demo",
      documentVersion: 2,
      sourcePosition: { kind: "media", startMs: 1_000, endMs: 2_000, segmentIndex: 1 },
    })).toMatchObject({ leftContext: "Hola", keyword: "Qué tal", rightContext: "amigo", location: { startMs: 1_000, endMs: 2_000 } });
  });

  it("builds source links that preserve article and media positions", () => {
    expect(contentSourceHref(
      { kind: "article", stableKey: "article.one", version: 2 },
      { kind: "text", paragraphId: "p-7", segmentIndex: 6 },
    )).toBe("/read/article/article.one#segment-6");
    expect(contentSourceHref(
      { kind: "media", stableKey: "media.one", version: 3 },
      { kind: "media", startMs: 12_340, endMs: 14_000, segmentIndex: 4 },
    )).toBe("/learn/media/media.one?t=12340&segment=4#segment-4");
  });
});
