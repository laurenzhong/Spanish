import { describe, expect, it } from "vitest";

import { discoveryContext, extractContentExpression, extractContentExpressions, type ContentDiscoverySegment } from "@/src/modules/lexicon-corpus/domain";

const segment: ContentDiscoverySegment = {
  documentKind: "media",
  contentKind: "video",
  documentStableKey: "video-1",
  documentVersion: 1,
  segmentIndex: 4,
  startMs: 12_000,
  endMs: 15_000,
  sourceText: "A Peppa le gusta salpicar.",
  sourceTitle: "Peppa",
  sourceKind: "youtube",
  publishedAt: new Date("2026-10-12T00:00:00Z"),
};

describe("published content discovery", () => {
  it("extracts a bounded, readable multi-word expression", () => {
    const expression = extractContentExpression(segment);
    expect(expression?.expression).toBe("Peppa le gusta");
    expect(expression?.normalizedExpression).toBe("peppa le gusta");
    expect(discoveryContext(expression!)).toEqual({ contextBefore: "A", contextAfter: "salpicar." });
  });

  it("does not return a one-word fragment or punctuation-only expression", () => {
    expect(extractContentExpression({ ...segment, sourceText: "¡Hola!" })).toBeNull();
    expect(extractContentExpressions({ ...segment, sourceText: "A los dos les gusta salpicar." }).every((item) => item.expression.split(/\s+/u).length >= 2)).toBe(true);
  });
});
