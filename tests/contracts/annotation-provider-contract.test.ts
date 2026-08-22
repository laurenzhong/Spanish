import { describe, expect, it } from "vitest";

import {
  AnnotationDraftError,
  FakeAnnotationDraftProvider,
  type AnnotationDraftInput,
} from "@/src/modules/providers/annotation";

const input: AnnotationDraftInput = {
  transcript: "¿Qué tal todo?",
  locale: "es-ES",
  contentVersion: "alpha-core-v1",
  attemptId: "00000000-0000-4000-8000-000000000001",
  generationId: 4,
  speechSignal: {
    quality: "usable",
    durationMs: 1200,
    voicedRatio: 0.8,
    pauseCount: 1,
    pauseRatio: 0.1,
    analyzer: "local-signal",
    algorithmVersion: "local-signal-v1",
    latencyMs: 2,
    retentionPolicy: "ephemeral",
  },
};

describe("AnnotationDraftProvider contract", () => {
  it("returns a human-review-only draft without learning state", async () => {
    const provider = new FakeAnnotationDraftProvider();
    const result = await provider.createDraft(input);

    expect(result.status).toBe("draft");
    expect(result.observations.every((observation) => observation.needsHumanReview)).toBe(true);
    expect(result.safety).toEqual({
      audioSent: false,
      writesEvidence: false,
      affectsMastery: false,
      affectsConfidence: false,
    });
    expect(result).not.toHaveProperty("score");
    expect(provider.inputs).toEqual([input]);
  });

  it.each([
    [{ ...input, transcript: "" }, "input-invalid"],
    [{ ...input, contentVersion: " " }, "input-invalid"],
    [{ ...input, attemptId: " " }, "input-invalid"],
    [{ ...input, generationId: -1 }, "input-invalid"],
  ] as const)("rejects invalid input with stable code", async (invalidInput, code) => {
    const provider = new FakeAnnotationDraftProvider();

    await expect(provider.createDraft(invalidInput)).rejects.toMatchObject({
      code,
      retryable: false,
    });
    expect(provider.inputs).toHaveLength(0);
  });

  it("maps deterministic failures without exposing provider details", async () => {
    const provider = new FakeAnnotationDraftProvider(
      new AnnotationDraftError("provider-unavailable", "temporary", true),
    );

    await expect(provider.createDraft(input)).rejects.toMatchObject({
      code: "provider-unavailable",
      retryable: true,
    });
  });

  it("honors cancellation before recording the input", async () => {
    const provider = new FakeAnnotationDraftProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.createDraft(input, { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "provider-cancelled" });
    expect(provider.inputs).toHaveLength(0);
  });
});

