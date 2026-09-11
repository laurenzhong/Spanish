export type ScenarioModality = "speech" | "typing";

export type TemporaryCharacterSnapshot = Readonly<{
  displayName: string;
  role: string;
  locale: string;
}>;

export type ScenarioTurnSpeaker = "user" | "temporary-character" | "condition";
export type ScenarioTurnStatus = "pending" | "completed" | "stopped" | "failed";
export type ScenarioReviewStatus = "pending" | "ready" | "unavailable";

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
