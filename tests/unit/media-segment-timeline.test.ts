// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { findSegmentIndexAt, parseWebVttSegments, validateSegmentTimeline } from "@/src/modules/media";

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

  it("accepts a long-form timeline with more than 500 sentence cues", () => {
    const segments = Array.from({ length: 501 }, (_, index) => ({
      index,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      sourceText: "Sí.",
      translation: "是。",
      speaker: null,
      confidence: null,
      sourceKind: "asr" as const,
    }));
    expect(() => validateSegmentTimeline(segments, 501_000)).not.toThrow();
  });

  it("accepts exact word timings inside a sentence cue", () => {
    const words = [
      { startMs: 0, endMs: 700, startOffset: 0, endOffset: 4, text: "Hola" },
      { startMs: 700, endMs: 1_500, startOffset: 5, endOffset: 10, text: "mundo" },
    ] as const;
    expect(() => validateSegmentTimeline([
      { index: 0, startMs: 0, endMs: 1_500, sourceText: "Hola mundo.", translation: "你好，世界。", speaker: null, confidence: null, sourceKind: "asr", words },
    ], 1_500)).not.toThrow();
  });

  it("rejects malformed, mismatched, or out-of-window word timings", () => {
    const base = { index: 0, startMs: 0, endMs: 2_000, sourceText: "Hola mundo.", translation: null, speaker: null, confidence: null, sourceKind: "asr" as const };
    expect(() => validateSegmentTimeline([{
      ...base,
      words: [
        { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4 },
        { startMs: 900, endMs: 2_000, startOffset: 4, endOffset: 10 },
      ],
    }], 2_000)).toThrow("MEDIA_SEGMENT_TIMELINE_INVALID");
    expect(() => validateSegmentTimeline([{
      ...base,
      words: [{ startMs: 0, endMs: 900, startOffset: 0, endOffset: 4 }],
    }], 2_000)).toThrow("MEDIA_SEGMENT_TIMELINE_INVALID");
    expect(() => validateSegmentTimeline([{
      ...base,
      words: [
        { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4 },
        { startMs: 900, endMs: 2_500, startOffset: 5, endOffset: 10 },
      ],
    }], 2_000)).toThrow("MEDIA_SEGMENT_TIMELINE_INVALID");
    expect(() => validateSegmentTimeline([{
      ...base,
      words: [
        { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4, text: "Adiós" },
        { startMs: 900, endMs: 2_000, startOffset: 5, endOffset: 10, text: "mundo" },
      ],
    }], 2_000)).toThrow("MEDIA_SEGMENT_TIMELINE_INVALID");
  });

  it("keeps accepting legacy timelines without word timings", () => {
    expect(() => validateSegmentTimeline([
      { index: 0, startMs: 0, endMs: 1_800, sourceText: "Buenos días.", translation: "早上好。", speaker: null, confidence: null, sourceKind: "platform_manual" },
    ], 1_800)).not.toThrow();
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
});
