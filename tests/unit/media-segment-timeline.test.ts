// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findSegmentIndexAt, maxMediaSegments, parseWebVttSegments, validateSegmentTimeline } from "@/src/modules/media";

describe("media segment timeline", () => {
  it("parses bounded VTT cues into deterministic millisecond segments", async () => {
    const input = await readFile(path.join(process.cwd(), "tests", "fixtures", "media", "captions", "valid-es.vtt"), "utf8");
    expect(parseWebVttSegments(input, { sourceKind: "platform_manual" })).toEqual([
      { index: 0, startMs: 0, endMs: 1_800, sourceText: "Buenos días.", translation: null, speaker: null, confidence: null, sourceKind: "platform_manual" },
      { index: 1, startMs: 1_800, endMs: 4_250, sourceText: "Quería un café con leche, por favor.", translation: null, speaker: null, confidence: null, sourceKind: "platform_manual" },
      { index: 2, startMs: 4_250, endMs: 6_000, sourceText: "Claro, ahora mismo.", translation: null, speaker: null, confidence: null, sourceKind: "platform_manual" },
    ]);
  });

  it("rejects inverted, overlapping, empty, and out-of-duration cues", () => {
    expect(() => validateSegmentTimeline([
      { index: 0, startMs: 0, endMs: 2_000, sourceText: "Uno", translation: null, speaker: null, confidence: null, sourceKind: "platform_auto" },
      { index: 1, startMs: 1_500, endMs: 3_000, sourceText: "Dos", translation: null, speaker: null, confidence: null, sourceKind: "platform_auto" },
    ], 10_000)).toThrow("MEDIA_SEGMENT_TIMELINE_INVALID");
    expect(() => parseWebVttSegments("WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nTexto", { sourceKind: "platform_auto" })).toThrow("MEDIA_SEGMENT_TIMELINE_INVALID");
    expect(() => validateSegmentTimeline([], 0)).toThrow("MEDIA_SEGMENT_TIMELINE_INVALID");
  });

  it("finds the active segment at exact boundaries", () => {
    const timeline = [
      { index: 0, startMs: 0, endMs: 1_000 },
      { index: 1, startMs: 1_000, endMs: 2_000 },
    ];
    expect(findSegmentIndexAt(timeline, 999)).toBe(0);
    expect(findSegmentIndexAt(timeline, 1_000)).toBe(1);
    expect(findSegmentIndexAt(timeline, 2_000)).toBeNull();
  });

  it("accepts the long-media limit and rejects one cue beyond it", () => {
    const segments = Array.from({ length: maxMediaSegments }, (_, index) => ({
      index,
      startMs: index,
      endMs: index + 1,
      sourceText: "x",
    }));
    expect(() => validateSegmentTimeline(segments, maxMediaSegments)).not.toThrow();
    expect(() => validateSegmentTimeline([...segments, { index: maxMediaSegments, startMs: maxMediaSegments, endMs: maxMediaSegments + 1, sourceText: "x" }], maxMediaSegments + 1)).toThrow("MEDIA_SEGMENT_TIMELINE_INVALID");
  });
});
