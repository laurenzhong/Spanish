import { minimumSpeechTranscriptConfidence, type AttemptEvaluationInput } from "@/src/modules/evidence";

import type { ScenarioTurn } from "../domain";

export function createScenarioEvidenceInput(input: Readonly<{
  turn: ScenarioTurn;
  contextualSuccess: boolean;
  hintLevel: 0 | 1 | 2 | 3;
  transcriptConfidence: number | null;
  contentVersion: number;
  skillKeys: readonly string[];
  idempotencyKey: string;
}>): AttemptEvaluationInput | null {
  if (input.turn.speaker !== "user" || input.turn.status !== "completed" || input.turn.modality === "system") return null;
  if (input.turn.modality === "speech" && (input.transcriptConfidence === null || input.transcriptConfidence < minimumSpeechTranscriptConfidence)) return null;
  const skillKeys = [...new Set(input.skillKeys.map((key) => key.trim()).filter(Boolean))];
  if (skillKeys.length === 0) return null;
  return {
    algorithmVersion: "scenario-evidence-v1",
    contentVersion: input.contentVersion,
    contextualSuccess: input.contextualSuccess,
    evaluationConfidence: 0.85,
    evidenceStrength: input.hintLevel === 0 ? "strong" : "moderate",
    hasUsableTranscript: input.turn.modality === "typing" || Boolean(input.turn.text.trim()),
    hintLevel: input.hintLevel,
    idempotencyKey: input.idempotencyKey,
    modality: input.turn.modality,
    practiceAttemptId: input.turn.id,
    skillObservations: skillKeys.map((skillKey) => ({ isTargetSkill: false, skillKey, tagWeight: 1 })),
    taskDifficulty: 0.7,
    targetExpressionUsed: false,
    technicalFailure: false,
    transcriptConfidence: input.transcriptConfidence,
    userId: input.turn.userId,
  };
}
