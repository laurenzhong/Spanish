// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  FakeMediaTranscriptionProvider,
  FakeMediaTranslationProvider,
  MediaProcessingError,
  processMediaTranscript,
  segmentMediaTranscript,
  type MediaTranscriptWordTiming,
} from "@/src/modules/media-processing";

const options = { durationMs: 8_000, minimumConfidence: 0.72 };

const holaMundoWords = [
  { startMs: 0, endMs: 500, startOffset: 0, endOffset: 4, text: "Hola" },
  { startMs: 500, endMs: 1_200, startOffset: 5, endOffset: 10, text: "mundo" },
] as const;

describe("segmentMediaTranscript word timings", () => {
  it("keeps provider word timings on the normalized ASR segments", () => {
    expect(segmentMediaTranscript([
      { startMs: 0, endMs: 1_200, text: " Hola mundo. ", confidence: 0.91, words: holaMundoWords },
    ], options)).toEqual([{
      index: 0,
      startMs: 0,
      endMs: 1_200,
      sourceText: "Hola mundo.",
      translation: null,
      speaker: null,
      confidence: 0.91,
      sourceKind: "asr",
      words: holaMundoWords,
    }]);
  });

  it("rejects non-integer or non-positive word timings", () => {
    const invalid: readonly (readonly MediaTranscriptWordTiming[])[] = [
      [{ startMs: 0, endMs: 500.5, startOffset: 0, endOffset: 4, text: "Hola" }],
      [{ startMs: 0, endMs: 500, startOffset: 0, endOffset: 4, text: "Hola" }, { startMs: 500, endMs: 500, startOffset: 5, endOffset: 10, text: "mundo" }],
    ];
    for (const words of invalid) {
      expect(() => segmentMediaTranscript([{ startMs: 0, endMs: 1_200, text: "Hola mundo.", confidence: 0.9, words }], options)).toThrow(MediaProcessingError);
    }
  });

  it("rejects overlapping word timings", () => {
    expect(() => segmentMediaTranscript([{
      startMs: 0,
      endMs: 1_200,
      text: "Hola mundo.",
      confidence: 0.9,
      words: [
        { startMs: 0, endMs: 600, startOffset: 0, endOffset: 4, text: "Hola" },
        { startMs: 500, endMs: 1_200, startOffset: 5, endOffset: 10, text: "mundo" },
      ],
    }], options)).toThrow(MediaProcessingError);
  });

  it("rejects word offsets outside the trimmed source text", () => {
    expect(() => segmentMediaTranscript([{
      startMs: 0,
      endMs: 1_200,
      text: "Hola mundo.",
      confidence: 0.9,
      words: [{ startMs: 0, endMs: 500, startOffset: 0, endOffset: 40, text: "Hola" }],
    }], options)).toThrow(MediaProcessingError);
    expect(() => segmentMediaTranscript([{
      startMs: 0,
      endMs: 1_200,
      text: "Hola mundo.",
      confidence: 0.9,
      words: [{ startMs: 0, endMs: 500, startOffset: 0, endOffset: 4, text: "Adiós" }],
    }], options)).toThrow(MediaProcessingError);
  });

  it("rejects word timings that escape the segment window", () => {
    expect(() => segmentMediaTranscript([{
      startMs: 1_000,
      endMs: 1_200,
      text: "Hola mundo.",
      confidence: 0.9,
      words: [
        { startMs: 0, endMs: 500, startOffset: 0, endOffset: 4, text: "Hola" },
        { startMs: 500, endMs: 1_200, startOffset: 5, endOffset: 10, text: "mundo" },
      ],
    }], options)).toThrow(MediaProcessingError);
    expect(() => segmentMediaTranscript([{
      startMs: 0,
      endMs: 1_200,
      text: "Hola mundo.",
      confidence: 0.9,
      words: [
        { startMs: 0, endMs: 500, startOffset: 0, endOffset: 4, text: "Hola" },
        { startMs: 500, endMs: 1_300, startOffset: 5, endOffset: 10, text: "mundo" },
      ],
    }], options)).toThrow(MediaProcessingError);
  });

  it("carries word timings through translation in the processing orchestrator", async () => {
    const result = await processMediaTranscript({
      input: {
        candidateId: "candidate-1",
        mediaType: "podcast",
        sourceUrl: "https://media.example.test/episode.mp3",
        sourceEnabled: true,
        rightsStatus: "verified",
        language: "es",
        durationMs: 8_000,
        assetBytes: 2_000_000,
        captionStatus: "unavailable",
        existingSegments: [],
        estimatedCostMicros: 10_000,
      },
      policy: { maxDurationMs: 30 * 60_000, maxAssetBytes: 50_000_000, maxEstimatedCostMicros: 2_000_000, minimumConfidence: 0.72 },
      artifactStore: { acquire: async () => ({ id: "tmp-1", path: "tmp/audio", byteSize: 2_000_000 }), delete: async () => undefined },
      transcriptionProvider: new FakeMediaTranscriptionProvider([
        { type: "segment", segment: { startMs: 0, endMs: 1_200, text: "Hola mundo.", confidence: 0.9, words: holaMundoWords } },
        { type: "done", providerRequestId: "req-1", modelVersion: "fake-asr-v1", estimatedCostMicros: 10_000 },
      ]),
      translationProvider: new FakeMediaTranslationProvider(() => "你好，世界。"),
    });

    expect(result.segments[0]).toMatchObject({ sourceText: "Hola mundo.", translation: "你好，世界。", words: holaMundoWords });
    expect(result.review).toEqual({ status: "review_ready", reason: "translated" });
  });
});
