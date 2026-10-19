// @vitest-environment node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sttServerMocks = vi.hoisted(() => ({
  createMiniMaxTranscriptionProvider: vi.fn(),
  createOpenAITranscriptionProvider: vi.fn(),
}));

vi.mock("@/src/modules/providers/stt/server", () => sttServerMocks);

import { createContentMediaRuntime, SpeechToMediaTranscriptionProvider } from "@/src/modules/content-acquisition/application/content-media-runtime";
import { FakeSpeechToTextProvider, type FakeSpeechToTextOutcome } from "@/src/modules/providers/stt";
import { hasExactWordLexemes, validWordTimings } from "@/src/modules/media/domain";
import type { MediaTranscriptionEvent } from "@/src/modules/media-processing";

async function collect(stream: AsyncIterable<MediaTranscriptionEvent>): Promise<MediaTranscriptionEvent[]> {
  const events: MediaTranscriptionEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("SpeechToMediaTranscriptionProvider word timeline", () => {
  let directory: string;
  let assetPath: string;

  beforeEach(async () => {
    sttServerMocks.createMiniMaxTranscriptionProvider.mockReset();
    sttServerMocks.createOpenAITranscriptionProvider.mockReset();
    directory = await mkdtemp(path.join(tmpdir(), "content-media-runtime-test-"));
    assetPath = path.join(directory, "audio.mp3");
    await writeFile(assetPath, new Uint8Array([1, 2, 3, 4]));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function provider(result: FakeSpeechToTextOutcome) {
    return new SpeechToMediaTranscriptionProvider(new FakeSpeechToTextProvider(result), { provider: "minimax", modelVersion: "asr-1.0" });
  }

  function input(durationMs = 5_000) {
    return { candidateId: "candidate-1", mediaType: "podcast" as const, language: "es" as const, durationMs, assetBytes: 4, assetPath };
  }

  it("requests word-level timestamps when the live runtime builds the MiniMax adapter", () => {
    createContentMediaRuntime({
      NODE_ENV: "test",
      CONTENT_MEDIA_PROVIDER_MODE: "live",
      CONTENT_MEDIA_STT_PROVIDER: "minimax",
      MINIMAX_API_KEY: "test-key",
      CONTENT_MEDIA_TRANSLATION_PROVIDER: "minimax",
    });

    expect(sttServerMocks.createMiniMaxTranscriptionProvider).toHaveBeenCalledWith(expect.objectContaining({ timestampLevel: "word" }));
  });

  it("groups provider word units into raw sentence segments that carry exact words", async () => {
    const events = await collect(provider({
      text: "Hola, ¿qué tal?",
      detectedLanguages: ["es"],
      confidence: 0.9,
      confidenceAvailability: "unavailable",
      provider: "fake",
      modelVersion: "fake-asr-v1",
      providerRequestId: "request-1",
      latencyMs: 0,
      estimatedCostMicros: 10,
      retentionPolicy: "ephemeral",
      segments: [
        { startMs: 0, endMs: 400, text: "Hola", speaker: null, confidence: null },
        { startMs: 400, endMs: 500, text: ",", speaker: null, confidence: null },
        { startMs: 600, endMs: 700, text: "¿", speaker: null, confidence: null },
        { startMs: 700, endMs: 1_100, text: "qué", speaker: null, confidence: null },
        { startMs: 1_100, endMs: 1_500, text: "tal", speaker: null, confidence: null },
        { startMs: 1_500, endMs: 1_600, text: "?", speaker: null, confidence: null },
      ],
    }).transcribe(input()));

    const segments = events.flatMap((event) => event.type === "segment" ? [event.segment] : []);
    expect(segments).toEqual([{
      startMs: 0,
      endMs: 1_600,
      text: "Hola, ¿qué tal?",
      confidence: 0.9,
      words: [
        { startMs: 0, endMs: 400, startOffset: 0, endOffset: 4, text: "Hola" },
        { startMs: 700, endMs: 1_100, startOffset: 7, endOffset: 10, text: "qué" },
        { startMs: 1_100, endMs: 1_500, startOffset: 11, endOffset: 14, text: "tal" },
      ],
    }]);
    for (const segment of segments) {
      expect(validWordTimings({ sourceText: segment.text, startMs: segment.startMs, endMs: segment.endMs, words: segment.words })).toHaveLength(3);
      expect(hasExactWordLexemes({ sourceText: segment.text, startMs: segment.startMs, endMs: segment.endMs, words: segment.words })).toBe(true);
    }
    expect(events.at(-1)).toMatchObject({ type: "done", providerRequestId: "request-1", modelVersion: "fake-asr-v1", estimatedCostMicros: 10 });
  });

  it("reuses an already grouped provider sentence timeline", async () => {
    const events = await collect(provider({
      text: "Hola, ¿qué tal?",
      detectedLanguages: ["es"],
      confidence: 0.9,
      confidenceAvailability: "unavailable",
      provider: "fake",
      modelVersion: "fake-asr-v1",
      providerRequestId: "request-2",
      latencyMs: 0,
      estimatedCostMicros: 10,
      retentionPolicy: "ephemeral",
      segments: [{
        startMs: 0,
        endMs: 1_600,
        text: "Hola, ¿qué tal?",
        speaker: null,
        confidence: null,
        words: [
          { startMs: 0, endMs: 400, startOffset: 0, endOffset: 4 },
          { startMs: 700, endMs: 1_100, startOffset: 7, endOffset: 10 },
          { startMs: 1_100, endMs: 1_500, startOffset: 11, endOffset: 14 },
        ],
      }],
    }).transcribe(input()));

    const segments = events.flatMap((event) => event.type === "segment" ? [event.segment] : []);
    expect(segments).toEqual([{
      startMs: 0,
      endMs: 1_600,
      text: "Hola, ¿qué tal?",
      confidence: 0.9,
      words: [
        { startMs: 0, endMs: 400, startOffset: 0, endOffset: 4, text: "Hola" },
        { startMs: 700, endMs: 1_100, startOffset: 7, endOffset: 10, text: "qué" },
        { startMs: 1_100, endMs: 1_500, startOffset: 11, endOffset: 14, text: "tal" },
      ],
    }]);
  });

  it("keeps the text-splitting fallback for providers without timing segments", async () => {
    const events = await collect(provider({
      text: "Hola mundo. Adiós.",
      detectedLanguages: ["es"],
      confidence: null,
      confidenceAvailability: "unavailable",
      provider: "openai",
      modelVersion: "gpt-transcribe",
      providerRequestId: null,
      latencyMs: 0,
      estimatedCostMicros: 0,
      retentionPolicy: "ephemeral",
    }).transcribe(input(4_000)));

    const segments = events.flatMap((event) => event.type === "segment" ? [event.segment] : []);
    expect(segments).toEqual([
      { startMs: 0, endMs: 2_000, text: "Hola mundo.", confidence: null },
      { startMs: 2_000, endMs: 4_000, text: "Adiós.", confidence: null },
    ]);
    expect(segments.every((segment) => segment.words === undefined)).toBe(true);
  });

  it("fails closed when provider word timings exceed the candidate duration", async () => {
    await expect(collect(provider({
      text: "Hola mundo",
      detectedLanguages: ["es"],
      confidence: null,
      confidenceAvailability: "unavailable",
      provider: "minimax",
      modelVersion: "asr-1.0",
      providerRequestId: null,
      latencyMs: 0,
      estimatedCostMicros: 10,
      retentionPolicy: "ephemeral",
      segments: [
        { startMs: 0, endMs: 500, text: "Hola", speaker: null, confidence: null },
        { startMs: 500, endMs: 6_000, text: "mundo", speaker: null, confidence: null },
      ],
    }).transcribe(input(5_000)))).rejects.toMatchObject({ code: "provider-response-invalid" });
  });

  it("fails closed instead of estimating when the provider returns sentence-level segments", async () => {
    await expect(collect(provider({
      text: "Buenos días.",
      detectedLanguages: ["es"],
      confidence: null,
      confidenceAvailability: "unavailable",
      provider: "minimax",
      modelVersion: "asr-1.0",
      providerRequestId: null,
      latencyMs: 0,
      estimatedCostMicros: 10,
      retentionPolicy: "ephemeral",
      segments: [
        { startMs: 0, endMs: 900, text: "Buenos días.", speaker: null, confidence: null },
      ],
    }).transcribe(input(1_000)))).rejects.toMatchObject({ code: "provider-response-invalid" });
  });
});
