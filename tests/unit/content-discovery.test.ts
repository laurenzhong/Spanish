import { describe, expect, it } from "vitest";

import { discoveryContext, extractContentExpression, extractContentExpressions, interleaveContentDiscoveryExpressions, type ContentDiscoveryExpression, type ContentDiscoverySegment } from "@/src/modules/lexicon-corpus/domain";

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

  it("rotates content kinds and documents before taking a second excerpt from one source", () => {
    function expression(contentKind: ContentDiscoverySegment["contentKind"], stableKey: string, index: number): ContentDiscoveryExpression {
      return {
        expression: `${stableKey} ${index}`,
        normalizedExpression: `${stableKey} ${index}`,
        segment: { ...segment, documentKind: contentKind === "article" ? "article" : "media", contentKind, documentStableKey: stableKey, segmentIndex: index },
        start: 0,
        end: 1,
      };
    }
    const input = [
      expression("podcast", "podcast-a", 0), expression("podcast", "podcast-a", 1),
      expression("podcast", "podcast-b", 0), expression("podcast", "podcast-b", 1),
      expression("video", "video-a", 0), expression("video", "video-a", 1),
      expression("video", "video-b", 0),
      expression("article", "article-a", 0), expression("article", "article-a", 1),
    ];
    const ordered = interleaveContentDiscoveryExpressions(input);
    expect(ordered.map((item) => item.expression)).toEqual([
      "article-a 0", "video-a 0", "podcast-a 0",
      "article-a 1", "video-b 0", "podcast-b 0",
      "video-a 1", "podcast-a 1", "podcast-b 1",
    ]);
    expect(interleaveContentDiscoveryExpressions(input)).toEqual(ordered);
  });
});
