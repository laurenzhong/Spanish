export const trainingStatuses = [
  "loading-context",
  "presenting-input",
  "awaiting-output",
  "recording",
  "transcribing",
  "evaluating",
  "showing-feedback",
  "transitioning",
  "completed",
  "recoverable-error",
] as const;

export type TrainingStatus = (typeof trainingStatuses)[number];
export type TrainingOutputMode = "speech" | "typing";
export type EvidenceStrength = "none" | "weak" | "moderate" | "strong";

export type TrainingEvaluation = Readonly<{
  contextualSuccess: boolean;
  evidenceStrength: EvidenceStrength;
  feedbackKey: string;
}>;

export type TrainingError = Readonly<{
  code: string;
  recoverTo: Exclude<TrainingStatus, "loading-context" | "recoverable-error">;
  technical: true;
}>;

export type TrainingState = Readonly<{
  status: TrainingStatus;
  contentKey: string | null;
  goalKey: string | null;
  outputMode: TrainingOutputMode;
  hintLevel: 0 | 1 | 2 | 3;
  generationId: number;
  transcript: string | null;
  evaluation: TrainingEvaluation | null;
  error: TrainingError | null;
}>;

export function createTrainingState(): TrainingState {
  return {
    status: "loading-context",
    contentKey: null,
    goalKey: null,
    outputMode: "speech",
    hintLevel: 0,
    generationId: 0,
    transcript: null,
    evaluation: null,
    error: null,
  };
}

export function nextGeneration(state: TrainingState): number {
  return state.generationId + 1;
}
