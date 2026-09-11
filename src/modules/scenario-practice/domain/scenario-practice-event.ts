import type {
  ScenarioModality,
  TemporaryCharacterSnapshot,
} from "./scenario-model";

type VersionedEvent = Readonly<{ expectedRevision: number }>;
type GeneratedEvent = Readonly<{ generationId: string }>;

export type ScenarioPracticeEvent =
  | (VersionedEvent & Readonly<{
      type: "scenario-prepared";
      communicationGoal: string;
      temporaryCharacter: TemporaryCharacterSnapshot;
    }>)
  | (VersionedEvent & GeneratedEvent & Readonly<{
      type: "start-recording";
      attemptId: string;
    }>)
  | (VersionedEvent & GeneratedEvent & Readonly<{ type: "recording-stopped" }>)
  | (VersionedEvent & GeneratedEvent & Readonly<{ type: "recording-cancelled" }>)
  | (VersionedEvent & GeneratedEvent & Readonly<{
      type: "transcription-succeeded";
      text: string;
      confidence: number;
    }>)
  | (VersionedEvent & GeneratedEvent & Readonly<{
      type: "transcription-failed";
      code: string;
    }>)
  | (VersionedEvent & Readonly<{ type: "confirm-transcript"; text: string }>)
  | (VersionedEvent & GeneratedEvent & Readonly<{
      type: "submit-typing";
      attemptId: string;
      text: string;
    }>)
  | (VersionedEvent & Readonly<{ type: "user-turn-persisted"; turnId: string }>)
  | (GeneratedEvent & Readonly<{ type: "roleplay-delta"; text: string }>)
  | (VersionedEvent & GeneratedEvent & Readonly<{ type: "roleplay-done"; turnId: string }>)
  | (VersionedEvent & GeneratedEvent & Readonly<{ type: "roleplay-failed"; code: string }>)
  | (VersionedEvent & Readonly<{ type: "request-hint"; level: 1 | 2 | 3 }>)
  | (VersionedEvent & Readonly<{ type: "pause" }>)
  | (VersionedEvent & Readonly<{ type: "resume" }>)
  | (VersionedEvent & GeneratedEvent & Readonly<{ type: "retry" }>)
  | (VersionedEvent & Readonly<{ type: "technical-failure"; code: string }>)
  | (VersionedEvent & Readonly<{ type: "complete-session" }>)
  | (VersionedEvent & Readonly<{ type: "session-finalized" }>)
  | (VersionedEvent & Readonly<{ type: "review-completed" }>)
  | (VersionedEvent & Readonly<{ type: "review-unavailable" }>)
  | (VersionedEvent & Readonly<{ type: "switch-modality"; modality: ScenarioModality }>);

export type ScenarioPracticeEventType = ScenarioPracticeEvent["type"];

export type ScenarioPracticeEffect =
  | Readonly<{ type: "persistCheckpoint" }>
  | Readonly<{ type: "startRecording"; attemptId: string; generationId: string }>
  | Readonly<{ type: "stopRecording"; generationId: string }>
  | Readonly<{ type: "requestTranscription"; attemptId: string; generationId: string }>
  | Readonly<{
      type: "persistUserTurn";
      attemptId: string;
      generationId: string;
      hintLevel: 0 | 1 | 2 | 3;
      modality: ScenarioModality;
      text: string;
      transcriptConfidence: number | null;
    }>
  | Readonly<{ type: "requestRoleplayReply"; generationId: string; replyToTurnId: string }>
  | Readonly<{
      type: "persistCompletedRoleplayTurn";
      generationId: string;
      replyToTurnId: string;
      text: string;
      turnId: string;
    }>
  | Readonly<{ type: "discardPartialRoleplayReply"; generationId: string }>
  | Readonly<{ type: "requestEvaluation" }>
  | Readonly<{ type: "finalizeSession" }>
  | Readonly<{ type: "showError"; code: string; technical: true }>
  | Readonly<{
      type: "rejectConflict";
      code: "SCENARIO_SESSION_CONFLICT";
      expectedRevision: number;
      currentRevision: number;
    }>
  | Readonly<{ type: "rejectEvent"; eventType: string; reason: string }>
  | Readonly<{
      type: "ignoreStaleGeneration";
      eventType: string;
      generationId: string;
      currentGenerationId: string | null;
    }>;

export type ScenarioPracticeTransition = Readonly<{
  state: import("./scenario-practice-state").ScenarioPracticeState;
  effects: readonly ScenarioPracticeEffect[];
}>;
