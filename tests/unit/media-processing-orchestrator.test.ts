import { describe, expect, it, vi } from "vitest";

import { FakeMediaTranscriptionProvider, FakeMediaTranslationProvider, processMediaTranscript, type MediaProcessingArtifactStore } from "@/src/modules/media-processing";

const policy = { maxDurationMs: 30 * 60 * 1_000, maxAssetBytes: 50_000_000, maxEstimatedCostMicros: 2_000_000, minimumConfidence: 0.72 };
const input = { candidateId: "candidate-1", mediaType: "podcast" as const, sourceUrl: "https://media.example.test/episode.mp3", sourceEnabled: true, rightsStatus: "verified" as const, language: "es", durationMs: 8_000, assetBytes: 2_000_000, captionStatus: "unavailable" as const, existingSegments: [], estimatedCostMicros: 10_000, processingAudience: "shared-learning" as const, processingAuthorization: { version: 1, allowedOperations: ["acquire-audio", "asr", "translate"], audience: "shared-learning", thirdPartyProcessing: true, evidenceUrl: "https://media.example.test/permission", expiresAt: null } };

function store(overrides: Partial<MediaProcessingArtifactStore> = {}): MediaProcessingArtifactStore {
  return { acquire: vi.fn(async () => ({ id: "tmp-1", path: "tmp/audio", byteSize: 2_000_000 })), delete: vi.fn(async () => undefined), ...overrides };
}

describe("media processing orchestrator", () => {
  it("requires an explicit done event and always cleans temporary audio", async () => {
    const artifacts = store();
    await expect(processMediaTranscript({ input, policy, artifactStore: artifacts, transcriptionProvider: new FakeMediaTranscriptionProvider([{ type: "segment", segment: { startMs: 0, endMs: 1_000, text: "Hola", confidence: 0.9 } }]) })).rejects.toMatchObject({ code: "MEDIA_TRANSCRIPTION_INCOMPLETE" });
    expect(artifacts.delete).toHaveBeenCalledWith("tmp-1");
  });

  it("keeps Spanish segments when translation fails and blocks low confidence", async () => {
    const artifacts = store();
    const result = await processMediaTranscript({
      input,
      policy,
      artifactStore: artifacts,
      transcriptionProvider: new FakeMediaTranscriptionProvider([
        { type: "segment", segment: { startMs: 0, endMs: 1_000, text: "Hola", confidence: 0.5 } },
        { type: "done", providerRequestId: "req-1", modelVersion: "fake-asr-v1", estimatedCostMicros: 10_000 },
      ]),
      translationProvider: new FakeMediaTranslationProvider(() => { throw new Error("translation unavailable"); }),
    });
    expect(result.segments[0]).toMatchObject({ sourceText: "Hola", translation: null, sourceKind: "asr" });
    expect(result.review).toEqual({ status: "blocked", reason: "low-confidence" });
    expect(artifacts.delete).toHaveBeenCalledWith("tmp-1");
  });

  it("does not call ASR when reviewed captions already exist", async () => {
    const provider = { transcribe: vi.fn() };
    const existing = [{ index: 0, startMs: 0, endMs: 900, sourceText: "Buenos días.", translation: null, speaker: null, confidence: null, sourceKind: "platform_manual" as const }];
    const result = await processMediaTranscript({ input: { ...input, captionStatus: "platform_manual", existingSegments: existing }, policy, artifactStore: store(), transcriptionProvider: provider });
    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(result.segments).toEqual(existing);
  });

  it("runs ASR when a stale caption label has no timeline", async () => {
    const provider = new FakeMediaTranscriptionProvider([
      { type: "segment", segment: { startMs: 0, endMs: 1_000, text: "Hola", confidence: 0.9 } },
      { type: "done", providerRequestId: "req-stale-caption", modelVersion: "fake-asr-v1", estimatedCostMicros: 10_000 },
    ]);
    const result = await processMediaTranscript({
      input: { ...input, captionStatus: "platform_auto", existingSegments: [] },
      policy,
      artifactStore: store(),
      transcriptionProvider: provider,
    });
    expect(result.provider).toMatchObject({ requestId: "req-stale-caption" });
    expect(result.segments[0]).toMatchObject({ sourceText: "Hola", sourceKind: "asr" });
  });

  it("fills missing translations on reviewed captions without rerunning ASR", async () => {
    const provider = { transcribe: vi.fn() };
    const existing = [{ index: 0, startMs: 0, endMs: 900, sourceText: "Buenos días.", translation: null, speaker: null, confidence: null, sourceKind: "platform_manual" as const }];
    const result = await processMediaTranscript({
      input: { ...input, captionStatus: "platform_manual", existingSegments: existing },
      policy,
      artifactStore: store(),
      transcriptionProvider: provider,
      translationProvider: new FakeMediaTranslationProvider(() => "早上好。"),
    });
    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(result.segments[0]).toMatchObject({ sourceText: "Buenos días.", translation: "早上好。" });
    expect(result.review).toEqual({ status: "review_ready", reason: "captions-present" });
  });

  it("cleans up after cancellation and surfaces cleanup failure", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(processMediaTranscript({ input, policy, artifactStore: store(), transcriptionProvider: new FakeMediaTranscriptionProvider([]), signal: controller.signal })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_CANCELLED" });
    const recordDeletionFailure = vi.fn(async () => undefined);
    await expect(processMediaTranscript({ input, policy, artifactStore: store({ delete: vi.fn(async () => { throw new Error("storage unavailable"); }), recordDeletionFailure }), transcriptionProvider: new FakeMediaTranscriptionProvider([{ type: "done", providerRequestId: null, modelVersion: "fake", estimatedCostMicros: 0 }]) })).rejects.toMatchObject({ code: "MEDIA_CLEANUP_FAILED" });
    expect(recordDeletionFailure).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "tmp-1", error: "storage unavailable" }));
  });

  it("distinguishes timeout from external cancellation and still cleans up", async () => {
    const artifacts = store();
    const provider = {
      async *transcribe() {
        await new Promise((resolve) => setTimeout(resolve, 25));
        yield { type: "done" as const, providerRequestId: null, modelVersion: "fake", estimatedCostMicros: 0 };
      },
    };
    await expect(processMediaTranscript({ input, policy, artifactStore: artifacts, transcriptionProvider: provider, timeoutMs: 5 })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_TIMED_OUT" });
    expect(artifacts.delete).toHaveBeenCalledWith("tmp-1");
  });

  it("rejects a provider result that exceeds the hard budget", async () => {
    const artifacts = store();
    await expect(processMediaTranscript({
      input: { ...input, estimatedCostMicros: 10 },
      policy: { ...policy, maxEstimatedCostMicros: 10 },
      artifactStore: artifacts,
      transcriptionProvider: new FakeMediaTranscriptionProvider([{ type: "done", providerRequestId: "req", modelVersion: "fake", estimatedCostMicros: 11 }]),
    })).rejects.toMatchObject({ code: "MEDIA_ASR_BUDGET_EXCEEDED" });
    expect(artifacts.delete).toHaveBeenCalledWith("tmp-1");
  });
});
