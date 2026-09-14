import { describe, expect, it } from "vitest";

import { MediaProcessingError, segmentMediaTranscript } from "@/src/modules/media-processing";

describe("media transcript segmentation", () => {
  it("normalizes text, indexes segments, and keeps ASR confidence", () => {
    expect(segmentMediaTranscript([
      { startMs: 0, endMs: 1_200, text: "  Hola. ", confidence: 0.91 },
      { startMs: 1_200, endMs: 2_500, text: "¿Qué tal?", confidence: 0.8, speaker: "host" },
    ], { durationMs: 3_000, minimumConfidence: 0.72 })).toEqual([
      { index: 0, startMs: 0, endMs: 1_200, sourceText: "Hola.", translation: null, speaker: null, confidence: 0.91, sourceKind: "asr" },
      { index: 1, startMs: 1_200, endMs: 2_500, sourceText: "¿Qué tal?", translation: null, speaker: "host", confidence: 0.8, sourceKind: "asr" },
    ]);
  });

  it("rejects overlap, out-of-range timing, and empty text", () => {
    expect(() => segmentMediaTranscript([{ startMs: 0, endMs: 1_000, text: "ok", confidence: null }, { startMs: 900, endMs: 1_500, text: "bad", confidence: null }], { durationMs: 2_000, minimumConfidence: 0.72 })).toThrow(MediaProcessingError);
    expect(() => segmentMediaTranscript([{ startMs: 0, endMs: 2_100, text: "bad", confidence: null }], { durationMs: 2_000, minimumConfidence: 0.72 })).toThrow(MediaProcessingError);
    expect(() => segmentMediaTranscript([{ startMs: 0, endMs: 1_000, text: "  ", confidence: null }], { durationMs: 2_000, minimumConfidence: 0.72 })).toThrow(MediaProcessingError);
  });
});
