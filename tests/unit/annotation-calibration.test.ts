import { describe, expect, it } from "vitest";

import {
  runAnnotationCalibrationBatch,
  type CalibrationAudioAsset,
  type CalibrationBatchSnapshot,
} from "@/src/modules/evidence/replay";
import {
  AnnotationDraftError,
  FakeAnnotationDraftProvider,
} from "@/src/modules/providers/annotation";
import {
  FakeSpeechToTextProvider,
  SpeechToTextError,
} from "@/src/modules/providers/stt";
import type { ReplayAudioManifest } from "@/src/modules/evidence/replay";

const firstEntry = {
  sampleId: "audio.1111111111111111",
  sha256: "1".repeat(64),
  format: ".mp3" as const,
  sizeBytes: 3,
  durationMs: null,
  sourceType: "external-audio" as const,
  authorizationStatus: "confirmed" as const,
};
const secondEntry = {
  ...firstEntry,
  sampleId: "audio.2222222222222222",
  sha256: "2".repeat(64),
};
const manifest: ReplayAudioManifest = {
  schemaVersion: "1.0",
  generatedAt: "2026-08-22T00:00:00.000Z",
  dryRun: true,
  entries: [firstEntry, secondEntry],
};

function asset(entry: ReplayAudioManifest["entries"][number]): CalibrationAudioAsset {
  return {
    sha256: entry.sha256,
    sizeBytes: entry.sizeBytes,
    format: entry.format,
    audioBytes: new Uint8Array([1, 2, 3]),
  };
}

describe("annotation calibration batch", () => {
  it("runs transcription before annotation and passes a null speech signal", async () => {
    const transcription = new FakeSpeechToTextProvider();
    const annotation = new FakeAnnotationDraftProvider();
    const writes: CalibrationBatchSnapshot[] = [];

    const result = await runAnnotationCalibrationBatch({
      manifest,
      runId: "calibration-v1-test",
      contentVersion: "alpha-core-v1",
      locale: "es-ES",
      readAudio: async (entry) => asset(entry),
      transcriptionProvider: transcription,
      annotationProvider: annotation,
      writeSnapshot: async (snapshot) => {
        writes.push(snapshot);
      },
    });

    expect(result.status).toBe("completed");
    expect(result.snapshot.samples).toHaveLength(2);
    expect(transcription.inputs[0]).toMatchObject({
      fileName: "audio.1111111111111111.mp3",
      mimeType: "audio/mpeg",
      languageTag: "es-ES",
    });
    expect(annotation.inputs).toHaveLength(2);
    expect(annotation.inputs.every((input) => input.speechSignal === null)).toBe(true);
    expect(writes.length).toBe(3);
    expect(JSON.stringify(result)).not.toContain("audioBytes");
    expect(JSON.stringify(result)).not.toContain("D:\\");
  });

  it("does not call providers when the external asset metadata does not match", async () => {
    const transcription = new FakeSpeechToTextProvider();
    const annotation = new FakeAnnotationDraftProvider();
    const result = await runAnnotationCalibrationBatch({
      manifest: { ...manifest, entries: [firstEntry] },
      runId: "calibration-v1-test",
      contentVersion: "alpha-core-v1",
      locale: "es-ES",
      readAudio: async () => ({ ...asset(firstEntry), sha256: "f".repeat(64) }),
      transcriptionProvider: transcription,
      annotationProvider: annotation,
    });

    expect(result.status).toBe("partial-failure");
    expect(result.snapshot.samples[0]).toMatchObject({
      status: "failed",
      stage: "audio",
      errorCode: "audio-metadata-mismatch",
    });
    expect(transcription.inputs).toHaveLength(0);
    expect(annotation.inputs).toHaveLength(0);
  });

  it("skips completed and failed samples unless retry-failed is enabled", async () => {
    const existing: CalibrationBatchSnapshot = {
      schemaVersion: "1.0",
      runId: "calibration-v1-test",
      status: "partial-failure",
      samples: [
        {
          sampleId: firstEntry.sampleId,
          attemptId: `calibration.${firstEntry.sampleId}`,
          status: "failed",
          stage: "transcription",
          errorCode: "provider-timeout",
          retryable: true,
        },
      ],
    };
    const transcription = new FakeSpeechToTextProvider();
    const annotation = new FakeAnnotationDraftProvider();
    const skipped = await runAnnotationCalibrationBatch({
      manifest: { ...manifest, entries: [firstEntry] },
      runId: existing.runId,
      contentVersion: "alpha-core-v1",
      locale: "es-ES",
      readAudio: async (entry) => asset(entry),
      transcriptionProvider: transcription,
      annotationProvider: annotation,
      existingSnapshot: existing,
    });
    expect(skipped.samples).toEqual([
      expect.objectContaining({ status: "skipped", reason: "previous-failure" }),
    ]);
    expect(transcription.inputs).toHaveLength(0);

    const retried = await runAnnotationCalibrationBatch({
      manifest: { ...manifest, entries: [firstEntry] },
      runId: existing.runId,
      contentVersion: "alpha-core-v1",
      locale: "es-ES",
      readAudio: async (entry) => asset(entry),
      transcriptionProvider: new FakeSpeechToTextProvider(),
      annotationProvider: new FakeAnnotationDraftProvider(),
      existingSnapshot: existing,
      retryFailed: true,
    });
    expect(retried.status).toBe("completed");
    expect(retried.snapshot.samples[0]?.status).toBe("completed");
  });

  it("continues after an isolated provider failure", async () => {
    let calls = 0;
    const transcription = new FakeSpeechToTextProvider(() => {
      calls += 1;
      return calls === 1
        ? new SpeechToTextError("provider-rate-limited", "temporary", true)
        : {
            text: "Hola",
            detectedLanguages: ["es"],
            confidence: null,
            confidenceAvailability: "unavailable",
            provider: "fake",
            modelVersion: "fake-v1",
            providerRequestId: "stt-2",
            latencyMs: 0,
            estimatedCostMicros: 0,
            retentionPolicy: "ephemeral",
          };
    });
    const annotation = new FakeAnnotationDraftProvider(
      new AnnotationDraftError("provider-unavailable", "temporary", true),
    );
    const result = await runAnnotationCalibrationBatch({
      manifest,
      runId: "calibration-v1-test",
      contentVersion: "alpha-core-v1",
      locale: "es-ES",
      readAudio: async (entry) => asset(entry),
      transcriptionProvider: transcription,
      annotationProvider: annotation,
    });

    expect(result.status).toBe("partial-failure");
    expect(result.snapshot.samples).toHaveLength(2);
    expect(result.snapshot.samples.every((sample) => sample.status === "failed")).toBe(true);
    expect(calls).toBe(2);
  });
});
