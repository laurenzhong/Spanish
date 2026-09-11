export type ScenarioModality = "speech" | "typing";

export type TemporaryCharacterSnapshot = Readonly<{
  displayName: string;
  role: string;
  locale: string;
}>;

export type ScenarioTurnSpeaker = "user" | "temporary-character" | "condition";
export type ScenarioTurnStatus = "pending" | "completed" | "stopped" | "failed";
export type ScenarioReviewStatus = "pending" | "ready" | "unavailable";

export type ScenarioTurnReview = Readonly<{
  id: string;
  turnId: string;
  userId: string;
  communicationSuccess: boolean | null;
  errorSpans: readonly Readonly<Record<string, unknown>>[];
  naturalAlternatives: readonly string[];
  hintLevel: 0 | 1 | 2 | 3;
  transcriptConfidence: number | null;
  status: ScenarioReviewStatus;
}>;

export type ScenarioTurn = Readonly<{
  id: string;
  sessionId: string;
  userId: string;
  turnIndex: number;
  speaker: ScenarioTurnSpeaker;
  modality: ScenarioModality | "system";
  text: string;
  status: ScenarioTurnStatus;
  attemptId: string | null;
  generationId: string | null;
}>;
