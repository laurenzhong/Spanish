import { describe, expect, it } from "vitest";

import { FakeSpeechToTextProvider } from "@/src/modules/providers/stt/fake-transcription";
import { backfillPublishedMediaTranscript } from "@/src/modules/media/application";
import type { MediaTranscriptBackfillRepository } from "@/src/modules/media/repositories";

describe("backfillPublishedMediaTranscript", () => {
  it("creates a review draft without publishing a media version", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    let released = false;
    const audio = {
      acquire: async () => ({ bytes, mimeType: "audio/mpeg", fileName: "sample.mp3", contentHash: "a".repeat(64), storageKey: null }),
      release: async () => { released = true; return "deleted" as const; },
    };
    const saved: { value?: Parameters<MediaTranscriptBackfillRepository["createTranscriptBackfill"]>[0] } = {};
    const repository: MediaTranscriptBackfillRepository = {
      createTranscriptBackfill: async (input) => {
        saved.value = input;
        return { id: "backfill-1", mediaStableKey: input.mediaStableKey, mediaVersionId: input.mediaVersionId, mediaItemId: input.mediaItemId, sourceVersion: input.sourceVersion, audioHash: input.audioHash, segments: input.segments, provider: input.provider, modelVersion: input.modelVersion, lowConfidence: input.lowConfidence, translationFailedCount: input.translationFailedCount, status: "draft", publishedVersion: null, reviews: { "content-es-ES": "pending", "teaching-zh-CN": "pending", structure: "pending" } };
      },
      reviewTranscriptBackfill: async () => { throw new Error("unused"); },
      publishTranscriptBackfill: async () => { throw new Error("unused"); },
    };
    const result = await backfillPublishedMediaTranscript({
      candidate: { id: "media-1", stableKey: "podcast.example.1", mediaItemId: "item-1", mediaVersionId: "version-1", version: 1, contentType: "podcast", language: "es", rightsStatus: "verified", durationMs: 60_000, assetBytes: bytes.byteLength, mimeType: "audio/mpeg", fileName: "sample.mp3", contentHash: null },
      audio,
      transcriptionProvider: new FakeSpeechToTextProvider({ text: "Hola. ¿Qué tal?", detectedLanguages: ["es"], confidence: 0.95, confidenceAvailability: "provider", provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 0, estimatedCostMicros: 0, retentionPolicy: "ephemeral" }),
      repository,
      budgetPolicy: { dailyCostLimitMicros: 1_000, monthlyCostLimitMicros: 1_000, maxCandidateBytes: 100, maxDurationSeconds: 120 },
      budgetUsage: { dailyCostMicros: 0, monthlyCostMicros: 0 },
      estimatedCostMicros: 0,
    });
    expect(result).toMatchObject({ backfillId: "backfill-1", segments: 2, lowConfidence: false, cleanupStatus: "deleted" });
    expect(saved.value?.segments).toHaveLength(2);
    expect(released).toBe(true);
  });

  it("uses the guarded draft replacement path when explicitly requested", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    let created = false;
    let replaced = false;
    const repository: MediaTranscriptBackfillRepository = {
      createTranscriptBackfill: async () => { created = true; throw new Error("unexpected create"); },
      replaceTranscriptBackfillDraft: async (input) => {
        replaced = true;
        return { id: "backfill-1", mediaStableKey: input.mediaStableKey, mediaVersionId: input.mediaVersionId, mediaItemId: input.mediaItemId, sourceVersion: input.sourceVersion, audioHash: input.audioHash, segments: input.segments, provider: input.provider, modelVersion: input.modelVersion, lowConfidence: input.lowConfidence, translationFailedCount: input.translationFailedCount, status: "draft", publishedVersion: null, reviews: { "content-es-ES": "pending", "teaching-zh-CN": "pending", structure: "pending" } };
      },
      reviewTranscriptBackfill: async () => { throw new Error("unused"); },
      publishTranscriptBackfill: async () => { throw new Error("unused"); },
    };
    const result = await backfillPublishedMediaTranscript({
      candidate: { id: "media-1", stableKey: "podcast.example.1", mediaItemId: "item-1", mediaVersionId: "version-1", version: 1, contentType: "podcast", language: "es", rightsStatus: "verified", durationMs: 60_000, assetBytes: bytes.byteLength, mimeType: "audio/mpeg", fileName: "sample.mp3", contentHash: null },
      audio: { acquire: async () => ({ bytes, mimeType: "audio/mpeg", fileName: "sample.mp3", contentHash: "a".repeat(64), storageKey: null }), release: async () => "deleted" as const },
      transcriptionProvider: new FakeSpeechToTextProvider({ text: "Hola.", detectedLanguages: ["es"], confidence: 0.95, confidenceAvailability: "provider", provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 0, estimatedCostMicros: 0, retentionPolicy: "ephemeral" }),
      repository,
      budgetPolicy: { dailyCostLimitMicros: 1_000, monthlyCostLimitMicros: 1_000, maxCandidateBytes: 100, maxDurationSeconds: 120 },
      budgetUsage: { dailyCostMicros: 0, monthlyCostMicros: 0 },
      estimatedCostMicros: 0,
      replaceExistingDraft: true,
    });
    expect(result.backfillId).toBe("backfill-1");
    expect(replaced).toBe(true);
    expect(created).toBe(false);
  });
});
