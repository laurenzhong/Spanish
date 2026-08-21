import type {
  EvidenceStrength,
  TrainingOutputMode,
  TrainingState,
} from "./training-state";

export type TrainingEvent =
  | Readonly<{ type: "content-loaded"; contentKey: string; goalKey: string }>
  | Readonly<{ type: "input-playback-completed" }>
  | Readonly<{ type: "input-playback-failed"; errorCode: string }>
  | Readonly<{ type: "start-recording" }>
  | Readonly<{
      type: "recording-start-failed";
      generationId: number;
      errorCode: string;
    }>
  | Readonly<{ type: "stop-recording"; generationId: number }>
  | Readonly<{ type: "cancel-recording"; generationId: number }>
  | Readonly<{
      type: "transcription-succeeded";
      generationId: number;
      transcript: string;
      confidence: number;
    }>
  | Readonly<{
      type: "transcription-failed";
      generationId: number;
      errorCode: string;
    }>
  | Readonly<{ type: "submit-typing"; text: string }>
  | Readonly<{
      type: "evaluation-succeeded";
      generationId: number;
      contextualSuccess: boolean;
      evidenceStrength: EvidenceStrength;
      feedbackKey: string;
    }>
  | Readonly<{
      type: "evaluation-failed";
      generationId: number;
      errorCode: string;
    }>
  | Readonly<{ type: "request-hint"; level: 1 | 2 | 3 }>
  | Readonly<{ type: "switch-to-silent" }>
  | Readonly<{ type: "continue" }>
  | Readonly<{ type: "enter-variant" }>
  | Readonly<{ type: "variant-ready" }>
  | Readonly<{ type: "complete-task" }>
  | Readonly<{ type: "retry" }>
  | Readonly<{ type: "exit" }>;

export type TrainingEventType = TrainingEvent["type"];

export function trainingEventFromJson(input: unknown): TrainingEvent {
  if (!input || typeof input !== "object" || !("type" in input)) {
    throw new Error("Training event must be an object with a type.");
  }

  return input as TrainingEvent;
}

export function eventRequiresGeneration(
  event: TrainingEvent,
): event is Extract<
  TrainingEvent,
  {
    generationId: number;
  }
> {
  return "generationId" in event;
}

export type TrainingOutputEffect =
  | Readonly<{ type: "play-input" }>
  | Readonly<{ type: "start-recording"; generationId: number }>
  | Readonly<{ type: "stop-recording"; generationId: number }>
  | Readonly<{ type: "transcribe"; generationId: number }>
  | Readonly<{
      type: "evaluate";
      generationId: number;
      outputMode: TrainingOutputMode;
    }>
  | Readonly<{ type: "show-feedback" }>
  | Readonly<{ type: "prepare-variant" }>
  | Readonly<{ type: "save-breakpoint" }>
  | Readonly<{ type: "show-error"; code: string; technical: true }>
  | Readonly<{ type: "exit-training" }>
  | Readonly<{ type: "reject-event"; eventType: string; reason: string }>
  | Readonly<{
      type: "ignore-stale-result";
      eventType: string;
      generationId: number;
      currentGenerationId: number;
    }>;

export type TrainingTransition = Readonly<{
  state: TrainingState;
  effects: readonly TrainingOutputEffect[];
}>;
