import type {
  ScenarioModality,
  TemporaryCharacterSnapshot,
} from "./scenario-model";

export const scenarioPracticeStatuses = [
  "preparing",
  "awaiting-expression",
  "recording",
  "transcribing",
  "awaiting-transcript-confirmation",
  "submitting-user-turn",
  "awaiting-roleplay-reply",
  "paused",
  "recoverable-error",
  "completed",
  "review-pending",
  "review-ready",
] as const;

export type ScenarioPracticeStatus = (typeof scenarioPracticeStatuses)[number];

export type ScenarioPracticeError = Readonly<{
  code: string;
  recoverTo:
    | "awaiting-expression"
    | "awaiting-transcript-confirmation"
    | "awaiting-roleplay-reply"
    | "review-pending";
  technical: true;
}>;

export type ScenarioPracticeState = Readonly<{
  sessionId: string;
  userId: string;
  clientAttemptId: string;
  status: ScenarioPracticeStatus;
  revision: number;
  communicationGoal: string | null;
  temporaryCharacter: TemporaryCharacterSnapshot | null;
  outputMode: ScenarioModality;
  hintLevel: 0 | 1 | 2 | 3;
  attemptId: string | null;
  generationId: string | null;
  transcript: string | null;
  transcriptConfidence: number | null;
  pendingUserTurnId: string | null;
  pendingReplyText: string;
  resumeTo: "awaiting-expression" | "awaiting-transcript-confirmation" | null;
  error: ScenarioPracticeError | null;
}>;

export function createScenarioPracticeState(input: Readonly<{
  sessionId: string;
  userId: string;
  clientAttemptId: string;
}>): ScenarioPracticeState {
  return {
    ...input,
    status: "preparing",
    revision: 1,
    communicationGoal: null,
    temporaryCharacter: null,
    outputMode: "speech",
    hintLevel: 0,
    attemptId: null,
    generationId: null,
    transcript: null,
    transcriptConfidence: null,
    pendingUserTurnId: null,
    pendingReplyText: "",
    resumeTo: null,
    error: null,
  };
}
