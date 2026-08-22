import { describe, expect, it } from "vitest";

import {
  FakeSpeechSignalAnalyzer,
  SpeechSignalError,
} from "@/src/modules/providers/speech";
import {
  analyzeSpeechSignalAttempt,
  SpeechSignalApplicationError,
  type AnalyzeSpeechSignalAttemptInput,
} from "@/src/modules/training/application";

const baseInput: AnalyzeSpeechSignalAttemptInput = {
  audioBytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/webm;codecs=opus",
  locale: "es-ES",
  attemptId: "00000000-0000-4000-8000-000000000102",
  generationId: 8,
  currentGenerationId: 8,
  outputMode: "speech",
};

describe("analyzeSpeechSignalAttempt", () => {
  it("maps a usable local observation to diagnostic-only output", async () => {
    const analyzer = new FakeSpeechSignalAnalyzer();

    await expect(analyzeSpeechSignalAttempt(analyzer, baseInput)).resolves.toMatchObject({
      status: "observed",
      attemptId: baseInput.attemptId,
      generationId: baseInput.generationId,
      quality: "usable",
      disposition: "diagnostic-only",
      observation: {
        analyzer: "fake",
        algorithmVersion: "fake-speech-signal-v1",
      },
    });
    expect(analyzer.inputs[0]).toMatchObject({
      attemptId: baseInput.attemptId,
      generationId: baseInput.generationId,
    });
  });

  it("keeps insufficient signal pending without negative evidence", async () => {
    const analyzer = new FakeSpeechSignalAnalyzer({
      outcome: {
        quality: "insufficient",
        durationMs: 300,
        voicedRatio: null,
        pauseCount: null,
        pauseRatio: null,
        analyzer: "fake",
        algorithmVersion: "fake-speech-signal-v1",
        latencyMs: 1,
        retentionPolicy: "ephemeral",
      },
    });

    await expect(analyzeSpeechSignalAttempt(analyzer, baseInput)).resolves.toMatchObject({
      status: "pending-verification",
      quality: "insufficient",
      disposition: "no-negative-evidence",
    });
  });

  it("ignores stale generations without calling the analyzer", async () => {
    const analyzer = new FakeSpeechSignalAnalyzer();

    await expect(
      analyzeSpeechSignalAttempt(analyzer, {
        ...baseInput,
        generationId: 7,
        currentGenerationId: 8,
      }),
    ).resolves.toMatchObject({
      status: "stale",
      disposition: "ignored-stale-result",
    });
    expect(analyzer.inputs).toHaveLength(0);
  });

  it("rejects typing without calling the analyzer", async () => {
    const analyzer = new FakeSpeechSignalAnalyzer();

    await expect(
      analyzeSpeechSignalAttempt(analyzer, { ...baseInput, outputMode: "typing" }),
    ).rejects.toBeInstanceOf(SpeechSignalApplicationError);
    expect(analyzer.inputs).toHaveLength(0);
  });

  it.each([
    ["audio-invalid", false],
    ["audio-format-unsupported", false],
    ["provider-cancelled", false],
  ] as const)("maps %s to recoverable no-evidence output", async (code, retryable) => {
    const analyzer = new FakeSpeechSignalAnalyzer({
      outcome: new SpeechSignalError(code, "stable local failure", retryable),
    });

    const result = await analyzeSpeechSignalAttempt(analyzer, {
      ...baseInput,
      ...(code === "audio-invalid" ? { audioBytes: new Uint8Array() } : {}),
      ...(code === "audio-format-unsupported" ? { mimeType: "audio/wma" } : {}),
    });

    expect(result).toMatchObject({
      status: "recoverable-error",
      code,
      retryable,
      disposition: "no-negative-evidence",
    });
  });

  it("does not expose capability fields or transcript text", async () => {
    const analyzer = new FakeSpeechSignalAnalyzer();
    const result = await analyzeSpeechSignalAttempt(analyzer, baseInput);

    expect("transcript" in result).toBe(false);
    expect("mastery" in result).toBe(false);
    expect("confidence" in result).toBe(false);
  });
});
