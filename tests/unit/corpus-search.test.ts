import { describe, expect, it } from "vitest";

import { buildKwic, matchesCorpusQuery, normalizeCorpusQuery } from "@/src/modules/lexicon-corpus/domain";

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
});
