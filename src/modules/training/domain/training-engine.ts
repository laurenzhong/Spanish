import type {
  TrainingEvent,
  TrainingEventType,
  TrainingTransition,
} from "./training-event";
import {
  createTrainingState,
  nextGeneration,
  type TrainingState,
} from "./training-state";

function reject(
  state: TrainingState,
  eventType: TrainingEventType,
  reason: string,
): TrainingTransition {
  return {
    state,
    effects: [{ type: "reject-event", eventType, reason }],
  };
}

function staleResult(
  state: TrainingState,
  event: Extract<TrainingEvent, { generationId: number }>,
): TrainingTransition {
  return {
    state,
    effects: [
      {
        type: "ignore-stale-result",
        eventType: event.type,
        generationId: event.generationId,
        currentGenerationId: state.generationId,
      },
    ],
  };
}

function technicalError(
  state: TrainingState,
  code: string,
  recoverTo: Exclude<TrainingState["status"], "loading-context" | "recoverable-error">,
): TrainingTransition {
  return {
    state: {
      ...state,
      status: "recoverable-error",
      error: { code, recoverTo, technical: true },
    },
    effects: [
      { type: "show-error", code, technical: true },
      { type: "save-breakpoint" },
    ],
  };
}

export function transition(
  state: TrainingState,
  event: TrainingEvent,
): TrainingTransition {
  if (event.type === "exit") {
    return {
      state,
      effects:
        state.status === "completed"
          ? [{ type: "exit-training" }]
          : [{ type: "save-breakpoint" }, { type: "exit-training" }],
    };
  }

  switch (state.status) {
    case "loading-context":
      if (event.type !== "content-loaded") {
        return reject(state, event.type, "Content must load before this event.");
      }
      return {
        state: {
          ...state,
          status: "presenting-input",
          contentKey: event.contentKey,
          goalKey: event.goalKey,
          generationId: nextGeneration(state),
          error: null,
        },
        effects: [{ type: "play-input" }],
      };

    case "presenting-input":
      if (event.type === "input-playback-completed") {
        return {
          state: { ...state, status: "awaiting-output" },
          effects: [{ type: "save-breakpoint" }],
        };
      }
      if (event.type === "input-playback-failed") {
        return technicalError(state, event.errorCode, "presenting-input");
      }
      if (event.type === "request-hint" && event.level > state.hintLevel) {
        return {
          state: { ...state, hintLevel: event.level },
          effects: [{ type: "save-breakpoint" }],
        };
      }
      return reject(state, event.type, "Input is still being presented.");

    case "awaiting-output":
      if (event.type === "start-recording") {
        const generationId = nextGeneration(state);
        return {
          state: {
            ...state,
            status: "recording",
            generationId,
            outputMode: "speech",
            transcript: null,
            evaluation: null,
            error: null,
          },
          effects: [{ type: "start-recording", generationId }],
        };
      }
      if (event.type === "submit-typing") {
        if (!event.text.trim()) {
          return reject(state, event.type, "Typed output cannot be empty.");
        }
        const generationId = nextGeneration(state);
        return {
          state: {
            ...state,
            status: "evaluating",
            generationId,
            outputMode: "typing",
            transcript: event.text.trim(),
            evaluation: null,
            error: null,
          },
          effects: [{ type: "evaluate", generationId, outputMode: "typing" }],
        };
      }
      if (event.type === "request-hint" && event.level > state.hintLevel) {
        return {
          state: { ...state, hintLevel: event.level },
          effects: [{ type: "save-breakpoint" }],
        };
      }
      if (event.type === "switch-to-silent") {
        return {
          state: { ...state, outputMode: "typing" },
          effects: [{ type: "save-breakpoint" }],
        };
      }
      return reject(state, event.type, "The learner is choosing an output.");

    case "recording":
      if (event.type === "stop-recording") {
        if (event.generationId !== state.generationId) return staleResult(state, event);
        return {
          state: { ...state, status: "transcribing", error: null },
          effects: [
            { type: "stop-recording", generationId: state.generationId },
            { type: "transcribe", generationId: state.generationId },
          ],
        };
      }
      if (event.type === "cancel-recording") {
        if (event.generationId !== state.generationId) return staleResult(state, event);
        return {
          state: { ...state, status: "awaiting-output", error: null },
          effects: [
            { type: "stop-recording", generationId: state.generationId },
            { type: "save-breakpoint" },
          ],
        };
      }
      return reject(state, event.type, "Recording must be stopped or cancelled.");

    case "transcribing":
      if (event.type === "transcription-succeeded") {
        if (event.generationId !== state.generationId) return staleResult(state, event);
        if (event.confidence < 0 || event.confidence > 1) {
          return technicalError(state, "invalid-transcript-confidence", "awaiting-output");
        }
        if (!event.transcript.trim()) {
          return technicalError(state, "empty-transcript", "awaiting-output");
        }
        return {
          state: {
            ...state,
            status: "evaluating",
            transcript: event.transcript.trim(),
            error: null,
          },
          effects: [
            {
              type: "evaluate",
              generationId: state.generationId,
              outputMode: "speech",
            },
          ],
        };
      }
      if (event.type === "transcription-failed") {
        if (event.generationId !== state.generationId) return staleResult(state, event);
        return technicalError(state, event.errorCode, "awaiting-output");
      }
      return reject(state, event.type, "A transcription result is required.");

    case "evaluating":
      if (event.type === "evaluation-succeeded") {
        if (event.generationId !== state.generationId) return staleResult(state, event);
        return {
          state: {
            ...state,
            status: "showing-feedback",
            evaluation: {
              contextualSuccess: event.contextualSuccess,
              evidenceStrength: event.evidenceStrength,
              feedbackKey: event.feedbackKey,
            },
            error: null,
          },
          effects: [{ type: "show-feedback" }, { type: "save-breakpoint" }],
        };
      }
      if (event.type === "evaluation-failed") {
        if (event.generationId !== state.generationId) return staleResult(state, event);
        return technicalError(state, event.errorCode, "awaiting-output");
      }
      return reject(state, event.type, "An evaluation result is required.");

    case "showing-feedback":
      if (event.type === "enter-variant") {
        return {
          state: { ...state, status: "transitioning", error: null },
          effects: [{ type: "prepare-variant" }],
        };
      }
      if (event.type === "continue" || event.type === "complete-task") {
        return {
          state: {
            ...state,
            status: event.type === "complete-task" ? "completed" : "transitioning",
          },
          effects:
            event.type === "complete-task"
              ? [{ type: "save-breakpoint" }]
              : [{ type: "save-breakpoint" }],
        };
      }
      return reject(state, event.type, "Feedback must be continued or completed.");

    case "transitioning":
      if (event.type === "variant-ready") {
        return {
          state: {
            ...state,
            status: "presenting-input",
            generationId: nextGeneration(state),
            hintLevel: 0,
            transcript: null,
            evaluation: null,
            error: null,
          },
          effects: [{ type: "play-input" }],
        };
      }
      return reject(state, event.type, "The next task is not ready.");

    case "recoverable-error":
      if (event.type === "retry") {
        const recoveryStatus = state.error?.recoverTo ?? "awaiting-output";
        return {
          state: { ...state, status: recoveryStatus, error: null, generationId: nextGeneration(state) },
          effects: recoveryStatus === "presenting-input" ? [{ type: "play-input" }] : [{ type: "save-breakpoint" }],
        };
      }
      return reject(state, event.type, "Retry or exit is required after a technical failure.");

    case "completed":
      return reject(state, event.type, "This task is already completed.");
  }
}

export function reduceTraining(
  events: readonly TrainingEvent[],
  initialState: TrainingState = createTrainingState(),
): TrainingTransition {
  let result: TrainingTransition = {
    state: initialState,
    effects: [],
  };
  for (const event of events) {
    result = transition(result.state, event);
  }
  return result;
}
