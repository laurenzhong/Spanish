import { describe, expect, it } from "vitest";

import {
  FakePronunciationProvider,
  PronunciationAssessmentError,
  maxPronunciationAudioBytes,
  type PronunciationAssessmentInput,
  type PronunciationAssessmentResult,
} from "@/src/modules/providers/pronunciation";

const input: PronunciationAssessmentInput = {
  audioBytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/webm;codecs=opus",
  fileName: "answer.webm",
  locale: "es-ES",
  referenceText: "¿Qué tal todo?",
  attemptId: "00000000-0000-4000-8000-000000000001",
  generationId: 4,
};

const insufficientResult: PronunciationAssessmentResult = {
  quality: "insufficient",
  pronunciationScore: null,
  fluencyScore: null,
  prosodyScore: null,
  completenessScore: null,
  provider: "fake",
  modelVersion: "fake-pronunciation-v1",
  providerRequestId: null,
  latencyMs: 0,
  estimatedCostMicros: 0,
  retentionPolicy: "ephemeral",
};

describe("PronunciationProvider contract", () => {
  it("returns safe, structured metrics and preserves request identity", async () => {
    const provider = new FakePronunciationProvider();

    const result = await provider.assess(input);

    expect(result).toMatchObject({
      quality: "usable",
      provider: "fake",
      retentionPolicy: "ephemeral",
    });
    expect(result.pronunciationScore).toBeGreaterThan(0);
    expect(result.fluencyScore).toBeGreaterThan(0);
    expect("transcript" in result).toBe(false);
    expect(provider.inputs).toEqual([input]);
  });

  it("represents insufficient audio without creating a negative score", async () => {
    const provider = new FakePronunciationProvider({ outcome: insufficientResult });

    await expect(provider.assess(input)).resolves.toEqual(insufficientResult);
    expect(insufficientResult.pronunciationScore).toBeNull();
    expect(insufficientResult.fluencyScore).toBeNull();
  });

  it.each([
    [{ ...input, audioBytes: new Uint8Array() }, "audio-invalid"],
    [{ ...input, audioBytes: new Uint8Array(maxPronunciationAudioBytes + 1) }, "audio-too-large"],
    [{ ...input, mimeType: "audio/ogg" }, "audio-format-unsupported"],
    [{ ...input, locale: "en-US" as "es-ES" }, "locale-unsupported"],
  ] as const)("rejects invalid input with stable code", async (invalidInput, code) => {
    const provider = new FakePronunciationProvider();

    await expect(provider.assess(invalidInput)).rejects.toMatchObject({
      code,
      retryable: false,
    });
    expect(provider.inputs).toHaveLength(0);
  });

  it("maps deterministic provider failures without exposing provider details", async () => {
    const provider = new FakePronunciationProvider({
      outcome: new PronunciationAssessmentError(
        "provider-rate-limited",
        "rate limited",
        true,
      ),
    });

    const failure = provider.assess(input);
    await expect(failure).rejects.toMatchObject({
      code: "provider-rate-limited",
      retryable: true,
    });
    await expect(failure).rejects.not.toThrow("provider details");
  });

  it("turns an aborted in-flight assessment into a stable cancellation", async () => {
    const provider = new FakePronunciationProvider({ delayMs: 50 });
    const controller = new AbortController();
    const pending = provider.assess(input, { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "provider-cancelled",
      retryable: false,
    });
  });
});
