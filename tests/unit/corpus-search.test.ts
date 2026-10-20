import { describe, expect, it } from "vitest";

import { buildKwic, contentSourceHref, matchesCorpusQuery, normalizeCorpusQuery } from "@/src/modules/lexicon-corpus/domain";
import { corpusBrowseQuerySchema, corpusQuerySchema } from "@/src/modules/lexicon-corpus/schemas/lexicon";

describe("corpus search", () => {
  it("normalizes accents and requires every query token", () => {
    expect(normalizeCorpusQuery("  Qué, tal  ")).toEqual(["que", "tal"]);
    expect(matchesCorpusQuery("¿Qué tal? Todo bien", ["que", "tal"])).toBe(true);
    expect(matchesCorpusQuery("Qué pasa", ["que", "tal"])).toBe(false);
  });

  it("keeps phrase matching contiguous and ordered", () => {
    expect(matchesCorpusQuery("No me doy cuenta de nada", ["dar", "cuenta"], "phrase")).toBe(false);
    expect(matchesCorpusQuery("No me doy cuenta de nada", ["doy", "cuenta"], "phrase")).toBe(true);
    expect(matchesCorpusQuery("Cuenta, dar y volver", ["dar", "cuenta"], "phrase")).toBe(false);
    expect(matchesCorpusQuery("Cuenta, dar y volver", ["dar", "cuenta"], "all")).toBe(true);
  });

  it("normalizes the browser q alias and defaults to phrase matching", () => {
    expect(corpusQuerySchema.parse({ q: "dar cuenta" })).toMatchObject({ query: "dar cuenta", match: "phrase", page: 1, pageSize: 20 });
  });

  it("allows the content-first browse feed without a query", () => {
    expect(corpusBrowseQuerySchema.parse({})).toEqual({ page: 1, pageSize: 8 });
    expect(corpusBrowseQuerySchema.parse({ contentKind: "podcast", pageSize: "12" })).toEqual({ contentKind: "podcast", page: 1, pageSize: 12 });
  });

  it("keeps content type filters in the validated search DTO", () => {
    expect(corpusQuerySchema.parse({ q: "por favor", contentKind: "podcast" })).toMatchObject({ query: "por favor", contentKind: "podcast" });
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
    )).toBe("/read/article/article.one%402#segment-6");
    expect(contentSourceHref(
      { kind: "media", stableKey: "media.one", version: 3 },
      { kind: "media", startMs: 12_340, endMs: 14_000, segmentIndex: 4 },
    )).toBe("/learn/media/media.one?t=12340&segment=4#segment-4");
  });
});
