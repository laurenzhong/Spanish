import type {
  AttemptEvaluationInput,
  SkillObservation,
} from "./evaluation-result";

const evidenceStrengthFactor = {
  none: 0,
  weak: 0.35,
  moderate: 0.65,
  strong: 1,
} as const;

const independenceFactor = [1, 0.8, 0.6, 0.4] as const;

export const minimumSpeechTranscriptConfidence = 0.75;

export type EvidenceStrengthCalculation = Readonly<{
  confidence: number;
  evidenceWeight: number;
}>;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function calculateEvidenceStrength(
  input: Pick<
    AttemptEvaluationInput,
    | "evaluationConfidence"
    | "evidenceStrength"
    | "hintLevel"
    | "modality"
    | "taskDifficulty"
    | "transcriptConfidence"
  >,
  observation: SkillObservation,
): EvidenceStrengthCalculation {
  const transcriptConfidence =
    input.modality === "speech" ? input.transcriptConfidence ?? 0 : 1;
  const confidence = clamp(input.evaluationConfidence * transcriptConfidence);
  const modalityReliability = input.modality === "speech" ? 1 : 0.6;
  const baseWeight =
    evidenceStrengthFactor[input.evidenceStrength] *
    independenceFactor[input.hintLevel] *
    modalityReliability *
    input.taskDifficulty *
    confidence;

  return {
    confidence,
    evidenceWeight: clamp(baseWeight * observation.tagWeight),
  };
}

export function isOralOnlySkill(skillKey: string): boolean {
  return ["fluency.", "pronunciation.", "reaction.", "oral."].some((prefix) =>
    skillKey.startsWith(prefix),
  );
}
