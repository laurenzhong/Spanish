import {
  calculateEvidenceStrength,
  isOralOnlySkill,
  minimumSpeechTranscriptConfidence,
} from "./evidence-strength";
import {
  parseAttemptEvaluation,
  type AttemptEvaluationInput,
  type SkillObservation,
} from "./evaluation-result";

export type EvidenceEventDraft = Readonly<{
  algorithmVersion: string;
  confidence: number;
  contentVersion: number;
  evidenceWeight: number;
  idempotencyKey: string;
  modality: "speech" | "typing";
  occurredAt: Date;
  outcomeScore: number;
  practiceAttemptId: string;
  skillKey: string;
  sourceReference: Record<string, unknown>;
  sourceType: "practice_attempt";
  userId: string;
}>;

export type AttemptEvaluation =
  | Readonly<{
      status: "ignored";
      reason: AttemptEvaluationIgnoreReason;
      events: readonly [];
    }>
  | Readonly<{
      status: "ready";
      events: readonly EvidenceEventDraft[];
    }>;

export type AttemptEvaluationIgnoreReason =
  | "empty-transcript"
  | "technical-failure"
  | "insufficient-transcript-confidence"
  | "no-eligible-skills"
  | "no-evidence-strength";

function ignored(
  reason: AttemptEvaluationIgnoreReason,
): AttemptEvaluation {
  return { status: "ignored", reason, events: [] };
}

function eligibleObservation(
  input: AttemptEvaluationInput,
  observation: SkillObservation,
): boolean {
  if (observation.isTargetSkill && !input.targetExpressionUsed) return false;
  if (observation.isTargetSkill && input.modality === "typing") return true;
  return input.modality === "speech" || !isOralOnlySkill(observation.skillKey);
}

export function evaluateAttempt(input: unknown): AttemptEvaluation {
  const parsed = parseAttemptEvaluation(input);

  if (parsed.technicalFailure) return ignored("technical-failure");
  if (parsed.modality === "speech" && !parsed.hasUsableTranscript) {
    return ignored("empty-transcript");
  }
  if (
    parsed.modality === "speech" &&
    (parsed.transcriptConfidence === null ||
      parsed.transcriptConfidence < minimumSpeechTranscriptConfidence)
  ) {
    return ignored("insufficient-transcript-confidence");
  }
  if (parsed.evidenceStrength === "none") return ignored("no-evidence-strength");

  const eligible = parsed.skillObservations.filter((observation) =>
    eligibleObservation(parsed, observation),
  );
  if (eligible.length === 0) return ignored("no-eligible-skills");

  const occurredAt = parsed.occurredAt ?? new Date();
  const events = eligible.flatMap((observation) => {
    const strength = calculateEvidenceStrength(parsed, observation);
    if (strength.evidenceWeight <= 0) return [];

    return [
      {
        algorithmVersion: parsed.algorithmVersion,
        confidence: strength.confidence,
        contentVersion: parsed.contentVersion,
        evidenceWeight: strength.evidenceWeight,
        idempotencyKey: `${parsed.idempotencyKey}:${observation.skillKey}`,
        modality: parsed.modality,
        occurredAt,
        outcomeScore: parsed.contextualSuccess ? 1 : 0,
        practiceAttemptId: parsed.practiceAttemptId,
        skillKey: observation.skillKey,
        sourceReference: {
          attemptId: parsed.practiceAttemptId,
          contextualSuccess: parsed.contextualSuccess,
          evaluationConfidence: parsed.evaluationConfidence,
          evidenceStrength: parsed.evidenceStrength,
          hintLevel: parsed.hintLevel,
          modality: parsed.modality,
          targetExpressionUsed: parsed.targetExpressionUsed,
          taskDifficulty: parsed.taskDifficulty,
          tagWeight: observation.tagWeight,
          transcriptConfidence: parsed.transcriptConfidence,
        },
        sourceType: "practice_attempt" as const,
        userId: parsed.userId,
      },
    ];
  });

  return events.length === 0
    ? ignored("no-evidence-strength")
    : { status: "ready", events };
}
