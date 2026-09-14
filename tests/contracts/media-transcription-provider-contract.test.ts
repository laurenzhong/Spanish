// @vitest-environment node

import { describe, expect, it } from "vitest";

import { consumeMediaTranscription, FakeMediaTranscriptionProvider } from "@/src/modules/media-processing";

describe("media transcription provider contract", () => {
  it("returns normalized segments only after an explicit done event", async () => {
    const provider = new FakeMediaTranscriptionProvider([
      { type: "segment", segment: { startMs: 0, endMs: 800, text: " Hola ", confidence: 0.9 } },
      { type: "done", providerRequestId: "request-1", modelVersion: "fake-v1", estimatedCostMicros: 120 },
    ]);
    await expect(consumeMediaTranscription(provider.transcribe({
      candidateId: "candidate-1", mediaType: "podcast", language: "es", durationMs: 1_000, assetBytes: 10, assetPath: "tmp/audio",
    }))).resolves.toEqual({
      segments: [{ startMs: 0, endMs: 800, text: " Hola ", confidence: 0.9 }],
      providerRequestId: "request-1", modelVersion: "fake-v1", estimatedCostMicros: 120,
    });
  });

  it("rejects a stream without done and preserves provider error classification", async () => {
    await expect(consumeMediaTranscription(new FakeMediaTranscriptionProvider([
      { type: "segment", segment: { startMs: 0, endMs: 800, text: "Hola", confidence: null } },
    ]).transcribe({
      candidateId: "candidate-1", mediaType: "video", language: "es", durationMs: 1_000, assetBytes: 10, assetPath: "tmp/audio",
    }))).rejects.toMatchObject({ code: "MEDIA_TRANSCRIPTION_INCOMPLETE", retryable: true });

    await expect(consumeMediaTranscription(new FakeMediaTranscriptionProvider([
      { type: "error", code: "provider-response-invalid", message: "invalid response" },
    ]).transcribe({
      candidateId: "candidate-1", mediaType: "video", language: "es", durationMs: 1_000, assetBytes: 10, assetPath: "tmp/audio",
    }))).rejects.toMatchObject({ code: "MEDIA_TRANSCRIPTION_FAILED", retryable: true });
  });

  it("honors cancellation before accepting a later event", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(consumeMediaTranscription(new FakeMediaTranscriptionProvider([
      { type: "done", providerRequestId: null, modelVersion: "fake-v1", estimatedCostMicros: 0 },
    ]).transcribe({
      candidateId: "candidate-1", mediaType: "video", language: "es", durationMs: 1_000, assetBytes: 10, assetPath: "tmp/audio",
    }), { signal: controller.signal })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_CANCELLED" });
  });
});
