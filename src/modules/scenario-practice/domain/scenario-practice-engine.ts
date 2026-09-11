import type {
  ScenarioPracticeEffect,
  ScenarioPracticeEvent,
  ScenarioPracticeTransition,
} from "./scenario-practice-event";
import type {
  ScenarioPracticeState,
  ScenarioPracticeStatus,
} from "./scenario-practice-state";

function versioned(
  state: ScenarioPracticeState,
  patch: Partial<ScenarioPracticeState>,
  effects: readonly ScenarioPracticeEffect[],
): ScenarioPracticeTransition {
  return {
    state: { ...state, ...patch, revision: state.revision + 1 },
    effects,
  };
}

function reject(
  state: ScenarioPracticeState,
  event: ScenarioPracticeEvent,
  reason: string,
): ScenarioPracticeTransition {
  return {
    state,
    effects: [{ type: "rejectEvent", eventType: event.type, reason }],
  };
}

function stale(
  state: ScenarioPracticeState,
  event: Extract<ScenarioPracticeEvent, { generationId: string }>,
): ScenarioPracticeTransition {
  return {
    state,
    effects: [{
      type: "ignoreStaleGeneration",
      eventType: event.type,
      generationId: event.generationId,
      currentGenerationId: state.generationId,
    }],
  };
}

function recoveryTarget(status: ScenarioPracticeStatus) {
  if (status === "awaiting-transcript-confirmation") return status;
  if (status === "awaiting-roleplay-reply") return status;
  if (status === "review-pending") return status;
  return "awaiting-expression" as const;
}

function technicalFailure(
  state: ScenarioPracticeState,
  code: string,
  extraEffects: readonly ScenarioPracticeEffect[] = [],
): ScenarioPracticeTransition {
  return versioned(
    state,
    {
      status: "recoverable-error",
      error: { code, recoverTo: recoveryTarget(state.status), technical: true },
    },
    [...extraEffects, { type: "showError", code, technical: true }, { type: "persistCheckpoint" }],
  );
}

function hasExpectedRevision(
  event: ScenarioPracticeEvent,
): event is ScenarioPracticeEvent & { expectedRevision: number } {
  return "expectedRevision" in event;
}

function hasGeneration(
  event: ScenarioPracticeEvent,
): event is Extract<ScenarioPracticeEvent, { generationId: string }> {
  return "generationId" in event;
}

export function transitionScenarioPractice(
  state: ScenarioPracticeState,
  event: ScenarioPracticeEvent,
): ScenarioPracticeTransition {
  if (hasExpectedRevision(event) && event.expectedRevision !== state.revision) {
    return {
      state,
      effects: [{
        type: "rejectConflict",
        code: "SCENARIO_SESSION_CONFLICT",
        expectedRevision: event.expectedRevision,
        currentRevision: state.revision,
      }],
    };
  }

  if (
    hasGeneration(event) &&
    event.type !== "start-recording" &&
    event.type !== "submit-typing" &&
    event.type !== "retry" &&
    event.generationId !== state.generationId
  ) {
    return stale(state, event);
  }

  if (event.type === "technical-failure") {
    return technicalFailure(state, event.code);
  }

  switch (state.status) {
    case "preparing":
      if (event.type !== "scenario-prepared") {
        return reject(state, event, "The scenario must be prepared first.");
      }
      if (!event.communicationGoal.trim() || !event.temporaryCharacter.displayName.trim()) {
        return reject(state, event, "The scenario preparation is incomplete.");
      }
      return versioned(state, {
        status: "awaiting-expression",
        communicationGoal: event.communicationGoal.trim(),
        temporaryCharacter: event.temporaryCharacter,
      }, [{ type: "persistCheckpoint" }]);

    case "awaiting-expression":
      if (event.type === "request-hint") {
        if (event.level <= state.hintLevel) {
          return reject(state, event, "Hint level cannot decrease or repeat.");
        }
        return versioned(state, { hintLevel: event.level }, [{ type: "persistCheckpoint" }]);
      }
      if (event.type === "switch-modality") {
        return versioned(state, { outputMode: event.modality }, [{ type: "persistCheckpoint" }]);
      }
      if (event.type === "start-recording") {
        return versioned(state, {
          status: "recording",
          outputMode: "speech",
          attemptId: event.attemptId,
          generationId: event.generationId,
          transcript: null,
          transcriptConfidence: null,
          pendingReplyText: "",
          error: null,
        }, [{ type: "startRecording", attemptId: event.attemptId, generationId: event.generationId }]);
      }
      if (event.type === "submit-typing") {
        const text = event.text.trim();
        if (!text) return reject(state, event, "Typed output cannot be empty.");
        return versioned(state, {
          status: "submitting-user-turn",
          outputMode: "typing",
          attemptId: event.attemptId,
          generationId: event.generationId,
          transcript: text,
          transcriptConfidence: null,
          pendingReplyText: "",
          error: null,
        }, [{
          type: "persistUserTurn",
          attemptId: event.attemptId,
          generationId: event.generationId,
          hintLevel: state.hintLevel,
          modality: "typing",
          text,
          transcriptConfidence: null,
        }]);
      }
      if (event.type === "pause") {
        return versioned(state, { status: "paused", resumeTo: "awaiting-expression" }, [{ type: "persistCheckpoint" }]);
      }
      if (event.type === "complete-session") {
        return versioned(state, { status: "completed" }, [{ type: "finalizeSession" }]);
      }
      return reject(state, event, "The learner is choosing an expression.");

    case "recording":
      if (event.type === "recording-stopped") {
        return versioned(state, { status: "transcribing" }, [
          { type: "stopRecording", generationId: event.generationId },
          { type: "requestTranscription", attemptId: state.attemptId!, generationId: event.generationId },
        ]);
      }
      if (event.type === "recording-cancelled") {
        return versioned(state, {
          status: "awaiting-expression",
          attemptId: null,
          generationId: null,
        }, [
          { type: "stopRecording", generationId: event.generationId },
          { type: "persistCheckpoint" },
        ]);
      }
      return reject(state, event, "Recording must be stopped or cancelled.");

    case "transcribing":
      if (event.type === "transcription-succeeded") {
        const text = event.text.trim();
        if (!text || event.confidence < 0 || event.confidence > 1) {
          return technicalFailure(state, "transcription-invalid");
        }
        return versioned(state, {
          status: "awaiting-transcript-confirmation",
          transcript: text,
          transcriptConfidence: event.confidence,
        }, [{ type: "persistCheckpoint" }]);
      }
      if (event.type === "transcription-failed") {
        return technicalFailure(state, event.code);
      }
      return reject(state, event, "A transcription result is required.");

    case "awaiting-transcript-confirmation":
      if (event.type === "request-hint") {
        if (event.level <= state.hintLevel) {
          return reject(state, event, "Hint level cannot decrease or repeat.");
        }
        return versioned(state, { hintLevel: event.level }, [{ type: "persistCheckpoint" }]);
      }
      if (event.type === "confirm-transcript") {
        const text = event.text.trim();
        if (!text || !state.attemptId || !state.generationId) {
          return reject(state, event, "A confirmed transcript and active attempt are required.");
        }
        return versioned(state, { status: "submitting-user-turn", transcript: text }, [{
          type: "persistUserTurn",
          attemptId: state.attemptId,
          generationId: state.generationId,
          hintLevel: state.hintLevel,
          modality: "speech",
          text,
          transcriptConfidence: state.transcriptConfidence,
        }]);
      }
      if (event.type === "pause") {
        return versioned(state, { status: "paused", resumeTo: "awaiting-transcript-confirmation" }, [{ type: "persistCheckpoint" }]);
      }
      return reject(state, event, "The transcript must be confirmed or the session paused.");

    case "submitting-user-turn":
      if (event.type !== "user-turn-persisted" || !state.generationId) {
        return reject(state, event, "The complete user turn must be persisted first.");
      }
      return versioned(state, {
        status: "awaiting-roleplay-reply",
        pendingUserTurnId: event.turnId,
        pendingReplyText: "",
      }, [{
        type: "requestRoleplayReply",
        generationId: state.generationId,
        replyToTurnId: event.turnId,
      }]);

    case "awaiting-roleplay-reply":
      if (event.type === "roleplay-delta") {
        if (!event.text) return reject(state, event, "A roleplay delta cannot be empty.");
        return {
          state: { ...state, pendingReplyText: state.pendingReplyText + event.text },
          effects: [],
        };
      }
      if (event.type === "roleplay-done") {
        if (!state.pendingReplyText || !state.pendingUserTurnId) {
          return technicalFailure(state, "SCENARIO_REPLY_INCOMPLETE");
        }
        return versioned(state, {
          status: "awaiting-expression",
          attemptId: null,
          generationId: null,
          transcript: null,
          transcriptConfidence: null,
          pendingUserTurnId: null,
          pendingReplyText: "",
          error: null,
        }, [
          {
            type: "persistCompletedRoleplayTurn",
            generationId: event.generationId,
            replyToTurnId: state.pendingUserTurnId,
            text: state.pendingReplyText,
            turnId: event.turnId,
          },
          { type: "persistCheckpoint" },
        ]);
      }
      if (event.type === "roleplay-failed") {
        return technicalFailure(
          state,
          event.code,
          state.pendingReplyText
            ? [{ type: "discardPartialRoleplayReply", generationId: event.generationId }]
            : [],
        );
      }
      return reject(state, event, "The temporary character reply is still running.");

    case "paused":
      if (event.type !== "resume" || !state.resumeTo) {
        return reject(state, event, "A paused session can only resume.");
      }
      return versioned(state, { status: state.resumeTo, resumeTo: null }, [{ type: "persistCheckpoint" }]);

    case "recoverable-error":
      if (event.type !== "retry" || !state.error) {
        return reject(state, event, "Retry is required after a technical failure.");
      }
      return versioned(state, {
        status: state.error.recoverTo,
        generationId: event.generationId,
        pendingReplyText: "",
        error: null,
      }, state.error.recoverTo === "awaiting-roleplay-reply" && state.pendingUserTurnId
        ? [{
            type: "requestRoleplayReply",
            generationId: event.generationId,
            replyToTurnId: state.pendingUserTurnId,
          }]
        : state.error.recoverTo === "review-pending"
          ? [{ type: "requestEvaluation" }]
          : [{ type: "persistCheckpoint" }]);

    case "completed":
      if (event.type !== "session-finalized") {
        return reject(state, event, "The completed session must be finalized.");
      }
      return versioned(state, { status: "review-pending" }, [{ type: "requestEvaluation" }]);

    case "review-pending":
      if (event.type === "review-completed") {
        return versioned(state, { status: "review-ready" }, [{ type: "persistCheckpoint" }]);
      }
      if (event.type === "review-unavailable") {
        return technicalFailure(state, "SCENARIO_REVIEW_PENDING");
      }
      return reject(state, event, "The review is still pending.");

    case "review-ready":
      return reject(state, event, "The scenario practice is complete.");
  }
}
