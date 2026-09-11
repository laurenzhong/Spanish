import { describe, expect, it } from "vitest";

import { createScenarioEvidenceInput, type ScenarioTurn } from "@/src/modules/scenario-practice";

const turn: ScenarioTurn = {
  id: "30000000-0000-4000-8000-000000000001", sessionId: "10000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000001", turnIndex: 0, speaker: "user", modality: "speech",
  text: "Necesito ayuda.", status: "completed", attemptId: "attempt-1", generationId: "generation-1",
};

describe("scenario evidence adapter", () => {
  it("creates evidence input only from a completed owned user turn", () => {
    expect(createScenarioEvidenceInput({ turn, contextualSuccess: true, hintLevel: 0, transcriptConfidence: 0.9, contentVersion: 1, skillKeys: ["communication.repair"], idempotencyKey: "review-1" })).toMatchObject({
      practiceAttemptId: turn.id, userId: turn.userId, modality: "speech", contextualSuccess: true,
      skillObservations: [{ skillKey: "communication.repair" }],
    });
    expect(createScenarioEvidenceInput({ turn: { ...turn, status: "pending" }, contextualSuccess: false, hintLevel: 0, transcriptConfidence: 0.9, contentVersion: 1, skillKeys: ["communication.repair"], idempotencyKey: "review-2" })).toBeNull();
  });

  it("keeps low-confidence speech neutral", () => {
    expect(createScenarioEvidenceInput({ turn, contextualSuccess: false, hintLevel: 0, transcriptConfidence: 0.5, contentVersion: 1, skillKeys: ["communication.repair"], idempotencyKey: "review-3" })).toBeNull();
  });
});
