import { describe, expect, it } from "vitest";

import { FakeMediaTranslationProvider } from "@/src/modules/providers/media-translation";
import { FakeMediaTranscriptionProvider } from "@/src/modules/providers/media-transcription";
import { SpeechToTextError } from "@/src/modules/providers/stt/transcription";
import { processMediaCandidate } from "@/src/modules/content-acquisition";

const candidate = {
  id: "candidate-1", contentType: "podcast" as const, language: "es", rightsStatus: "verified" as const,
  durationMs: 10_000, assetBytes: 8, mimeType: "audio/mpeg", fileName: "episode.mp3", contentHash: "a".repeat(64),
};

const policy = { dailyCostLimitMicros: 1_000, monthlyCostLimitMicros: 5_000, maxCandidateBytes: 100, maxDurationSeconds: 60 };

describe("media processing orchestrator", () => {
  it("transcribes, translates, persists a draft, and always releases temporary audio", async () => {
    const transcription = new FakeMediaTranscriptionProvider({
      text: "Hola. ¿Qué tal?", detectedLanguages: ["es"], confidence: 0.72, confidenceAvailability: "provider", provider: "fake", modelVersion: "fake-v1", providerRequestId: "stt-1", latencyMs: 1, estimatedCostMicros: 20, retentionPolicy: "ephemeral",
    });
    const translation = new FakeMediaTranslationProvider({ text: "你好。", provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 0, estimatedCostMicros: 2 });
    const released: string[] = [];
    let saved = false;
    const result = await processMediaCandidate({
      candidate, budgetPolicy: policy, budgetUsage: { dailyCostMicros: 0, monthlyCostMicros: 0 }, estimatedCostMicros: 20,
      audio: { acquire: async () => ({ bytes: new Uint8Array(8), mimeType: "audio/mpeg", fileName: "episode.mp3", contentHash: "b".repeat(64) }), release: async (asset) => { released.push(asset.contentHash); return "deleted"; } },
      transcriptionProvider: transcription, translationProvider: translation,
      repository: { saveTranscriptDraft: async () => { saved = true; } },
    });
    expect(result).toMatchObject({ status: "succeeded", transcriptSource: "asr", lowConfidence: true, translationFailedCount: 0, cleanupStatus: "deleted" });
    expect(result.segments[0].translation).toBe("你好。");
    expect(saved).toBe(true);
    expect(released).toEqual(["b".repeat(64)]);
  });

  it("does not call providers when the budget is exhausted", async () => {
    const provider = new FakeMediaTranscriptionProvider();
    await expect(processMediaCandidate({
      candidate, budgetPolicy: policy, budgetUsage: { dailyCostMicros: 1_000, monthlyCostMicros: 0 }, estimatedCostMicros: 20,
      audio: { acquire: async () => { throw new Error("should not acquire"); }, release: async () => "deleted" }, transcriptionProvider: provider,
    })).rejects.toMatchObject({ code: "MEDIA_ASR_BLOCKED_DAILY-COST" });
    expect(provider.inputs).toHaveLength(0);
  });

  it("fails a chunk without producing a partial transcript and still cleans up", async () => {
    const provider = new FakeMediaTranscriptionProvider(() => new SpeechToTextError("provider-unavailable", "provider failed", true));
    let released = false;
    await expect(processMediaCandidate({
      candidate: { ...candidate, assetBytes: 8 }, budgetPolicy: policy, budgetUsage: { dailyCostMicros: 0, monthlyCostMicros: 0 }, estimatedCostMicros: 20,
      audio: { acquire: async () => ({ bytes: new Uint8Array(8), mimeType: "audio/mpeg", fileName: "episode.mp3", contentHash: "c".repeat(64) }), release: async () => { released = true; return "deleted"; } }, transcriptionProvider: provider,
    })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_FAILED" });
    expect(released).toBe(true);
  });

  it("keeps Spanish text when one translation request fails", async () => {
    const translation = new FakeMediaTranslationProvider(() => new Error("translation unavailable"));
    const result = await processMediaCandidate({
      candidate, budgetPolicy: policy, budgetUsage: { dailyCostMicros: 0, monthlyCostMicros: 0 }, estimatedCostMicros: 20,
      audio: { acquire: async () => ({ bytes: new Uint8Array(8), mimeType: "audio/mpeg", fileName: "episode.mp3", contentHash: "d".repeat(64) }), release: async () => "deleted" },
      transcriptionProvider: new FakeMediaTranscriptionProvider(), translationProvider: translation,
    });
    expect(result.translationFailedCount).toBeGreaterThan(0);
    expect(result.segments[0].sourceText).toBe("Hola, ¿qué tal?");
    expect(result.segments[0].translation).toBeNull();
  });

  it("treats an incomplete provider stream as failure and still releases audio", async () => {
    const provider = new FakeMediaTranscriptionProvider({
      text: "partial", detectedLanguages: ["es"], confidence: 0.9, confidenceAvailability: "provider", provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 0, estimatedCostMicros: 0, retentionPolicy: "ephemeral",
      done: false,
    } as never);
    let released = false;
    await expect(processMediaCandidate({
      candidate, budgetPolicy: policy, budgetUsage: { dailyCostMicros: 0, monthlyCostMicros: 0 }, estimatedCostMicros: 20,
      audio: { acquire: async () => ({ bytes: new Uint8Array(8), mimeType: "audio/mpeg", fileName: "episode.mp3", contentHash: "e".repeat(64) }), release: async () => { released = true; return "deleted"; } }, transcriptionProvider: provider,
    })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_FAILED" });
    expect(released).toBe(true);
  });
});
