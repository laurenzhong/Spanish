import { describe, expect, it } from "vitest";

import {
  evaluateAttempt,
  minimumSpeechTranscriptConfidence,
} from "@/src/modules/evidence/domain";

const userId = "00000000-0000-4000-8000-000000000001";
const attemptId = "00000000-0000-4000-8000-000000000002";

function input(overrides: Record<string, unknown> = {}) {
  return {
    algorithmVersion: "evidence-v1",
    contentVersion: 1,
    contextualSuccess: true,
    evaluationConfidence: 0.95,
    evidenceStrength: "strong",
    hasUsableTranscript: true,
    hintLevel: 0,
    idempotencyKey: "attempt-1",
    modality: "speech",
    occurredAt: new Date("2026-08-21T12:00:00.000Z"),
    practiceAttemptId: attemptId,
    skillObservations: [
      { isTargetSkill: false, skillKey: "task.start", tagWeight: 0.8 },
      {
        isTargetSkill: false,
        skillKey: "fluency.turn-taking",
        tagWeight: 0.2,
      },
    ],
    taskDifficulty: 0.8,
    targetExpressionUsed: true,
    technicalFailure: false,
    transcriptConfidence: 0.96,
    userId,
    ...overrides,
  };
}

describe("evaluateAttempt", () => {
  it("creates bounded evidence for a successful speech attempt", () => {
    const result = evaluateAttempt(input());

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      modality: "speech",
      outcomeScore: 1,
      skillKey: "task.start",
      sourceType: "practice_attempt",
      userId,
    });
    expect(result.events[0]!.confidence).toBeCloseTo(0.912, 10);
    expect(result.events[0]!.evidenceWeight).toBeGreaterThan(0);
    expect(result.events[0]!.evidenceWeight).toBeLessThanOrEqual(1);
  });

  it("does not create evidence for a low-confidence or missing transcript", () => {
    expect(
      evaluateAttempt(
        input({ transcriptConfidence: minimumSpeechTranscriptConfidence - 0.01 }),
      ),
    ).toMatchObject({ status: "ignored", reason: "insufficient-transcript-confidence" });
    expect(evaluateAttempt(input({ transcriptConfidence: null }))).toMatchObject({
      status: "ignored",
      reason: "insufficient-transcript-confidence",
    });
    expect(evaluateAttempt(input({ hasUsableTranscript: false }))).toMatchObject({
      status: "ignored",
      reason: "empty-transcript",
    });
  });

  it("does not turn a technical failure into negative evidence", () => {
    expect(evaluateAttempt(input({ technicalFailure: true }))).toMatchObject({
      status: "ignored",
      reason: "technical-failure",
    });
  });

  it("keeps target-skill mastery separate from natural task success", () => {
    const result = evaluateAttempt(
      input({
        skillObservations: [
          { isTargetSkill: true, skillKey: "target.expression", tagWeight: 0.8 },
          { isTargetSkill: false, skillKey: "task.start", tagWeight: 0.8 },
        ],
        targetExpressionUsed: false,
      }),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.events.map((event) => event.skillKey)).toEqual([
      "task.start",
    ]);
  });

  it("does not let typing update oral-only skills", () => {
    const result = evaluateAttempt(
      input({
        idempotencyKey: "typing-1",
        modality: "typing",
        transcriptConfidence: null,
        skillObservations: [
          { isTargetSkill: false, skillKey: "task.start", tagWeight: 0.8 },
          {
            isTargetSkill: false,
            skillKey: "fluency.turn-taking",
            tagWeight: 0.2,
          },
        ],
      }),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.events.map((event) => event.skillKey)).toEqual(["task.start"]);
  });
});
