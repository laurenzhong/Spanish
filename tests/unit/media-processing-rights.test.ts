// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { FakeMediaTranscriptionProvider, processMediaTranscript, type ProcessMediaTranscriptInput } from "@/src/modules/media-processing";

const grant = {
  version: 1, allowedOperations: ["acquire-audio", "asr", "translate"],
  audience: "shared-learning", thirdPartyProcessing: true,
  evidenceUrl: "https://source.example.test/processing-permission", expiresAt: null,
};
const segments = [0, 1].map((index) => ({ index, startMs: index * 1000, endMs: index * 1000 + 900, sourceText: "Hola.", translation: null, speaker: null, confidence: null, sourceKind: "platform_manual" as const }));
const input = {
  candidateId: "candidate-1", mediaType: "video" as const, sourceUrl: "https://source.example.test/audio",
  sourceEnabled: true, rightsStatus: "verified" as const, language: "es", durationMs: 3000,
  assetBytes: 100, captionStatus: "platform_manual" as const, existingSegments: segments,
  estimatedCostMicros: 0, processingAuthorization: grant, processingAudience: "shared-learning" as const,
};
function setup(overrides: Partial<ProcessMediaTranscriptInput> = {}) {
  const artifactStore = { acquire: vi.fn(async () => ({ id: "tmp", path: "tmp/audio", byteSize: 100 })), delete: vi.fn(async () => undefined) };
  const translationProvider = { translate: vi.fn(async () => ({ text: "Hello", modelVersion: "fake", providerRequestId: null, estimatedCostMicros: 0 })) };
  const transcriptionProvider = new FakeMediaTranscriptionProvider([
    { type: "segment", segment: { startMs: 0, endMs: 900, text: "Hola", confidence: 0.9 } },
    { type: "done", providerRequestId: null, modelVersion: "fake", estimatedCostMicros: 0 },
  ]);
  const transcribe = vi.spyOn(transcriptionProvider, "transcribe");
  return { input: { ...input, ...overrides }, artifactStore, translationProvider, transcriptionProvider, transcribe,
    policy: { maxDurationMs: 10000, maxAssetBytes: 1000, maxEstimatedCostMicros: 100, minimumConfidence: 0.7 } };
}

describe("processing-time media authorization", () => {
  it.each([
    { sourceEnabled: false }, { rightsStatus: "unknown" as const },
    { rightsStatus: "revoked" as const }, { rightsStatus: "restricted" as const },
    { processingAuthorization: undefined },
    { processingAuthorization: { ...grant, allowedOperations: ["asr", "acquire-audio"] } },
    { processingAuthorization: { ...grant, thirdPartyProcessing: false } },
    { processingAuthorization: { ...grant, audience: "owner-private" } },
    { processingAuthorization: { ...grant, expiresAt: "2020-01-01T00:00:00.000Z" } },
    { processingAuthorization: { ...grant, expiresAt: "invalid" } },
    { processingAuthorization: { ...grant, evidenceUrl: "http://source.example.test/permission" } },
  ])("rejects caption translation before any side effect: %j", async (overrides) => {
    const options = setup(overrides);
    await expect(processMediaTranscript(options)).rejects.toMatchObject({ code: "MEDIA_PROCESSING_NOT_AUTHORIZED" });
    expect(options.translationProvider.translate).not.toHaveBeenCalled();
    expect(options.artifactStore.acquire).not.toHaveBeenCalled();
    expect(options.transcribe).not.toHaveBeenCalled();
  });

  it.each([undefined, { ...grant, allowedOperations: ["asr", "translate"] }, { ...grant, allowedOperations: ["acquire-audio", "translate"] }, { ...grant, allowedOperations: ["acquire-audio", "asr"] }])("preflights the entire ASR/translation chain: %j", async (processingAuthorization) => {
    const options = setup({ captionStatus: "unavailable", existingSegments: [], processingAuthorization });
    await expect(processMediaTranscript(options)).rejects.toMatchObject({ code: "MEDIA_PROCESSING_NOT_AUTHORIZED" });
    expect(options.artifactStore.acquire).not.toHaveBeenCalled();
    expect(options.transcribe).not.toHaveBeenCalled();
    expect(options.translationProvider.translate).not.toHaveBeenCalled();
  });

  it("does not require audio/ASR permission when only translating captions", async () => {
    const options = setup({ processingAuthorization: { ...grant, allowedOperations: ["translate"] } });
    const result = await processMediaTranscript(options);
    expect(result.segments.every((segment) => segment.translation === "Hello")).toBe(true);
    expect(options.artifactStore.acquire).not.toHaveBeenCalled();
    expect(options.transcribe).not.toHaveBeenCalled();
  });

  it("rejects already cancelled caption work with zero provider calls", async () => {
    const options = setup();
    const controller = new AbortController(); controller.abort();
    await expect(processMediaTranscript({ ...options, signal: controller.signal })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_CANCELLED" });
    expect(options.translationProvider.translate).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"])("rejects late caption provider %s after timeout", async (mode) => {
    const options = setup();
    options.translationProvider.translate.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (mode === "reject") throw new Error("late failure");
      return { text: "late", modelVersion: "fake", providerRequestId: null, estimatedCostMicros: 0 };
    });
    await expect(processMediaTranscript({ ...options, timeoutMs: 5 })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_TIMED_OUT" });
    expect(options.translationProvider.translate).toHaveBeenCalledTimes(1);
  });

  it("revalidates after each translation and stops on revocation", async () => {
    const options = setup(); let enabled = true;
    options.translationProvider.translate.mockImplementation(async () => {
      enabled = false;
      return { text: "late", modelVersion: "fake", providerRequestId: null, estimatedCostMicros: 0 };
    });
    const revalidate = vi.fn(async () => ({ sourceEnabled: enabled, rightsStatus: "verified" as const, processingAuthorization: grant }));
    await expect(processMediaTranscript({ ...options, revalidate })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_NOT_AUTHORIZED" });
    expect(options.translationProvider.translate).toHaveBeenCalledTimes(1);
  });

  it("revalidates after acquisition before ASR and cleans up on revocation", async () => {
    const options = setup({ captionStatus: "unavailable", existingSegments: [] }); let enabled = true;
    options.artifactStore.acquire.mockImplementation(async () => { enabled = false; return { id: "tmp", path: "tmp/audio", byteSize: 100 }; });
    const revalidate = vi.fn(async () => ({ sourceEnabled: enabled, rightsStatus: "verified" as const, processingAuthorization: grant }));
    await expect(processMediaTranscript({ ...options, revalidate })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_NOT_AUTHORIZED" });
    expect(options.transcribe).not.toHaveBeenCalled();
    expect(options.artifactStore.delete).toHaveBeenCalledWith("tmp");
  });

  it("rejects permission expiring at the current instant", async () => {
    const options = setup({ processingAuthorization: { ...grant, expiresAt: "2026-10-16T00:00:00.000Z" } });
    await expect(processMediaTranscript({ ...options, now: () => new Date("2026-10-16T00:00:00.000Z") })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_NOT_AUTHORIZED" });
    expect(options.translationProvider.translate).not.toHaveBeenCalled();
  });

  it("rejects permission expiring during translation", async () => {
    const options = setup({ processingAuthorization: { ...grant, expiresAt: "2026-10-16T00:00:01.000Z" } });
    let now = new Date("2026-10-16T00:00:00.000Z");
    options.translationProvider.translate.mockImplementation(async () => { now = new Date("2026-10-16T00:00:01.000Z"); return { text: "late", modelVersion: "fake", providerRequestId: null, estimatedCostMicros: 0 }; });
    await expect(processMediaTranscript({ ...options, now: () => now })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_NOT_AUTHORIZED" });
    expect(options.translationProvider.translate).toHaveBeenCalledTimes(1);
  });

  it("does not accept provider success after external cancellation", async () => {
    const options = setup(); const controller = new AbortController();
    options.translationProvider.translate.mockImplementation(async () => { controller.abort(); return { text: "late", modelVersion: "fake", providerRequestId: null, estimatedCostMicros: 0 }; });
    await expect(processMediaTranscript({ ...options, signal: controller.signal })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_CANCELLED" });
    expect(options.translationProvider.translate).toHaveBeenCalledTimes(1);
  });

  it("does not require a new processing grant for an already complete timeline", async () => {
    const options = setup({ processingAuthorization: undefined, existingSegments: segments.map((segment) => ({ ...segment, translation: "Hello" })) });
    expect((await processMediaTranscript(options)).provider).toBeNull();
    expect(options.translationProvider.translate).not.toHaveBeenCalled();
  });

  it("allows ASR without translation permission when no translation is requested", async () => {
    const options = setup({ captionStatus: "unavailable", existingSegments: [], processingAuthorization: { ...grant, allowedOperations: ["acquire-audio", "asr"] } });
    expect((await processMediaTranscript({ ...options, translationProvider: undefined })).provider).toMatchObject({ modelVersion: "fake" });
    expect(options.artifactStore.delete).toHaveBeenCalledWith("tmp");
  });

  it("rejects revocation while deleting an acquired artifact", async () => {
    const options = setup({ captionStatus: "unavailable", existingSegments: [] }); let enabled = true;
    options.artifactStore.delete.mockImplementation(async () => { enabled = false; });
    const revalidate = async () => ({ sourceEnabled: enabled, rightsStatus: "verified" as const, processingAuthorization: grant });
    await expect(processMediaTranscript({ ...options, revalidate })).rejects.toMatchObject({ code: "MEDIA_PROCESSING_NOT_AUTHORIZED" });
    expect(options.artifactStore.delete).toHaveBeenCalledWith("tmp");
  });

  it("does not swallow revalidation failure as a partial translation", async () => {
    const options = setup(); let failed = false;
    options.translationProvider.translate.mockImplementation(async () => { failed = true; throw new Error("provider failure"); });
    const revalidate = async () => { if (failed) throw new Error("authority lookup failed"); return input; };
    await expect(processMediaTranscript({ ...options, revalidate })).rejects.toThrow("authority lookup failed");
    expect(options.translationProvider.translate).toHaveBeenCalledTimes(1);
  });
});
