import { describe, expect, it } from "vitest";

import {
  FakePronunciationProvider,
  PronunciationAssessmentError,
} from "@/src/modules/providers/pronunciation";
import {
  assessPronunciationAttempt,
  PronunciationApplicationError,
  type AssessPronunciationAttemptInput,
} from "@/src/modules/training/application";

const baseInput: AssessPronunciationAttemptInput = {
  audioBytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/webm;codecs=opus",
  fileName: "answer.webm",
  locale: "es-ES",
  referenceText: "¿Cómo va todo?",
  attemptId: "00000000-0000-4000-8000-000000000001",
  generationId: 4,
  currentGenerationId: 4,
  outputMode: "speech",
  assessmentMode: "sampled",
};

describe("assessPronunciationAttempt", () => {
  it("records provider metadata without changing the observation result", async () => {
    const provider = new FakePronunciationProvider();
    const calls: unknown[] = [];
    const result = await assessPronunciationAttempt(provider, baseInput, {
      observer: { record: async (input) => { calls.push(input); } },
    });

    expect(result.status).toBe("observed");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      providerType: "pronunciation",
      provider: "fake",
      status: "succeeded",
      correlation: {
        attemptId: baseInput.attemptId,
        generationId: String(baseInput.generationId),
      },
    });
  });

  it("maps a usable provider result to an observation-only result", async () => {
    const provider = new FakePronunciationProvider();

    const result = await assessPronunciationAttempt(provider, baseInput);

    expect(result).toEqual({
      status: "observed",
      attemptId: baseInput.attemptId,
      generationId: 4,
      quality: "usable",
      observation: {
        attemptId: baseInput.attemptId,
        generationId: 4,
        provider: "fake",
        modelVersion: "fake-pronunciation-v1",
        pronunciationScore: 0.84,
        fluencyScore: 0.78,
        prosodyScore: 0.74,
        completenessScore: 0.96,
        providerRequestId: null,
        latencyMs: 0,
        estimatedCostMicros: 0,
        retentionPolicy: "ephemeral",
        disposition: "observation-only",
      },
    });
    expect("transcript" in result).toBe(false);
    expect("mastery" in result).toBe(false);
    expect("confidence" in result).toBe(false);
    expect(provider.inputs).toHaveLength(1);
    expect(provider.inputs[0]).toMatchObject({
      attemptId: baseInput.attemptId,
      generationId: baseInput.generationId,
    });
  });

  it("passes the human-confirmed transcript as the pronunciation reference", async () => {
    const provider = new FakePronunciationProvider();
    const confirmedTranscript = "Mucha gente dice que el trabajo es el futuro.";

    await assessPronunciationAttempt(provider, {
      ...baseInput,
      referenceText: confirmedTranscript,
    });

    expect(provider.inputs[0]?.referenceText).toBe(confirmedTranscript);
  });

  it.each([
    [{ outputMode: "typing" as const }, "spoken output"],
    [{ assessmentMode: "typing" as const }, "sampled or explicit review"],
  ])("rejects ineligible request: %s", async (overrides, message) => {
    const provider = new FakePronunciationProvider();

    await expect(
      assessPronunciationAttempt(provider, { ...baseInput, ...overrides }),
    ).rejects.toBeInstanceOf(PronunciationApplicationError);
    await expect(assessPronunciationAttempt(provider, { ...baseInput, ...overrides }))
      .rejects.toThrow(message);
    expect(provider.inputs).toHaveLength(0);
  });

  it("ignores an obsolete generation without calling the provider", async () => {
    const provider = new FakePronunciationProvider();

    await expect(
      assessPronunciationAttempt(provider, {
        ...baseInput,
        generationId: 3,
        currentGenerationId: 4,
      }),
    ).resolves.toEqual({
      status: "stale",
      attemptId: baseInput.attemptId,
      generationId: 3,
      currentGenerationId: 4,
      disposition: "ignored-stale-result",
    });
    expect(provider.inputs).toHaveLength(0);
  });

  it("turns insufficient provider output into pending verification", async () => {
    const provider = new FakePronunciationProvider({
      outcome: {
        quality: "insufficient",
        pronunciationScore: null,
        fluencyScore: null,
        prosodyScore: null,
        completenessScore: null,
        provider: "fake",
        modelVersion: "fake-pronunciation-v1",
        providerRequestId: null,
        latencyMs: 3,
        estimatedCostMicros: 0,
        retentionPolicy: "ephemeral",
      },
    });

    await expect(assessPronunciationAttempt(provider, baseInput)).resolves.toEqual({
      status: "pending-verification",
      attemptId: baseInput.attemptId,
      generationId: 4,
      quality: "insufficient",
      provider: "fake",
      modelVersion: "fake-pronunciation-v1",
      providerRequestId: null,
      latencyMs: 3,
      disposition: "no-negative-evidence",
    });
  });

  it.each([
    ["provider-cancelled", false],
    ["provider-timeout", true],
    ["provider-unavailable", true],
  ] as const)("maps %s to a recoverable no-evidence result", async (code, retryable) => {
    const provider = new FakePronunciationProvider({
      outcome: new PronunciationAssessmentError(
        code,
        "stable provider failure",
        retryable,
      ),
    });

    await expect(assessPronunciationAttempt(provider, baseInput)).resolves.toEqual({
      status: "recoverable-error",
      attemptId: baseInput.attemptId,
      generationId: 4,
      code,
      retryable,
      disposition: "no-negative-evidence",
    });
  });

  it("preserves caller cancellation through the provider boundary", async () => {
    const provider = new FakePronunciationProvider({ delayMs: 50 });
    const controller = new AbortController();
    const pending = assessPronunciationAttempt(provider, baseInput, {
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).resolves.toMatchObject({
      status: "recoverable-error",
      code: "provider-cancelled",
      retryable: false,
      disposition: "no-negative-evidence",
    });
  });

  it("validates audio before invoking the provider", async () => {
    const provider = new FakePronunciationProvider();

    await expect(
      assessPronunciationAttempt(provider, {
        ...baseInput,
        audioBytes: new Uint8Array(),
      }),
    ).rejects.toMatchObject({ code: "audio-invalid" });
    expect(provider.inputs).toHaveLength(0);
  });
});
