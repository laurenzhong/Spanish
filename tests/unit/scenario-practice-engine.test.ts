import { describe, expect, it } from "vitest";

import {
  createScenarioPracticeState,
  transitionScenarioPractice,
  type ScenarioPracticeEvent,
  type ScenarioPracticeState,
} from "@/src/modules/scenario-practice";

const ids = {
  attempt: "attempt-restaurant-1",
  characterTurn: "20000000-0000-4000-8000-000000000002",
  generation: "generation-restaurant-1",
  session: "10000000-0000-4000-8000-000000000001",
  user: "00000000-0000-4000-8000-000000000001",
  userTurn: "20000000-0000-4000-8000-000000000001",
} as const;

function apply(state: ScenarioPracticeState, event: ScenarioPracticeEvent) {
  return transitionScenarioPractice(state, event);
}

function readyState() {
  const initial = createScenarioPracticeState({
    clientAttemptId: "session-attempt-1",
    sessionId: ids.session,
    userId: ids.user,
  });
  return apply(initial, {
    type: "scenario-prepared",
    expectedRevision: initial.revision,
    communicationGoal: "Pedir una comida y confirmar el precio.",
    temporaryCharacter: {
      displayName: "Carmen",
      role: "camarera",
      locale: "es-ES",
    },
  }).state;
}

describe("scenario practice engine", () => {
  it("moves through speech confirmation and only completes the character turn after done", () => {
    let state = readyState();
    expect(state.status).toBe("awaiting-expression");

    let result = apply(state, {
      type: "start-recording",
      attemptId: ids.attempt,
      generationId: ids.generation,
      expectedRevision: state.revision,
    });
    state = result.state;
    expect(result.effects).toEqual([
      { type: "startRecording", attemptId: ids.attempt, generationId: ids.generation },
    ]);

    result = apply(state, {
      type: "recording-stopped",
      generationId: ids.generation,
      expectedRevision: state.revision,
    });
    state = result.state;
    expect(state.status).toBe("transcribing");
    expect(result.effects.map((effect) => effect.type)).toEqual([
      "stopRecording",
      "requestTranscription",
    ]);

    result = apply(state, {
      type: "transcription-succeeded",
      generationId: ids.generation,
      expectedRevision: state.revision,
      text: "Quisiera la sopa, por favor.",
      confidence: 0.72,
    });
    state = result.state;
    expect(state.status).toBe("awaiting-transcript-confirmation");

    result = apply(state, {
      type: "confirm-transcript",
      expectedRevision: state.revision,
      text: "Quisiera la sopa, por favor.",
    });
    state = result.state;
    expect(result.effects).toEqual([
      expect.objectContaining({
        type: "persistUserTurn",
        attemptId: ids.attempt,
        modality: "speech",
      }),
    ]);

    result = apply(state, {
      type: "user-turn-persisted",
      expectedRevision: state.revision,
      turnId: ids.userTurn,
    });
    state = result.state;
    expect(state.status).toBe("awaiting-roleplay-reply");
    expect(result.effects).toEqual([
      { type: "requestRoleplayReply", generationId: ids.generation, replyToTurnId: ids.userTurn },
    ]);

    result = apply(state, {
      type: "roleplay-delta",
      generationId: ids.generation,
      text: "Lo siento, ",
    });
    state = result.state;
    expect(result.effects).toEqual([]);
    expect(state.pendingReplyText).toBe("Lo siento, ");

    result = apply(state, {
      type: "roleplay-done",
      generationId: ids.generation,
      expectedRevision: state.revision,
      turnId: ids.characterTurn,
    });
    expect(result.state.status).toBe("awaiting-expression");
    expect(result.effects).toEqual([
      {
        type: "persistCompletedRoleplayTurn",
        generationId: ids.generation,
        replyToTurnId: ids.userTurn,
        text: "Lo siento, ",
        turnId: ids.characterTurn,
      },
      { type: "persistCheckpoint" },
    ]);
  });

  it("rejects old revisions and ignores callbacks from an old generation", () => {
    const ready = readyState();
    const conflict = apply(ready, {
      type: "request-hint",
      level: 1,
      expectedRevision: ready.revision - 1,
    });
    expect(conflict.state).toBe(ready);
    expect(conflict.effects).toEqual([
      {
        type: "rejectConflict",
        code: "SCENARIO_SESSION_CONFLICT",
        expectedRevision: ready.revision - 1,
        currentRevision: ready.revision,
      },
    ]);

    const recording = apply(ready, {
      type: "start-recording",
      attemptId: ids.attempt,
      generationId: ids.generation,
      expectedRevision: ready.revision,
    }).state;
    const stale = apply(recording, {
      type: "recording-stopped",
      generationId: "old-generation",
      expectedRevision: recording.revision,
    });
    expect(stale.state).toBe(recording);
    expect(stale.effects).toEqual([
      {
        type: "ignoreStaleGeneration",
        eventType: "recording-stopped",
        generationId: "old-generation",
        currentGenerationId: ids.generation,
      },
    ]);
  });

  it("only increases the hint level across retries and restoration", () => {
    let state = readyState();
    state = apply(state, {
      type: "request-hint",
      level: 2,
      expectedRevision: state.revision,
    }).state;
    const lower = apply(state, {
      type: "request-hint",
      level: 1,
      expectedRevision: state.revision,
    });
    expect(lower.state).toBe(state);
    expect(lower.state.hintLevel).toBe(2);
    expect(lower.effects[0]).toMatchObject({ type: "rejectEvent" });

    const failed = apply(state, {
      type: "technical-failure",
      code: "provider-timeout",
      expectedRevision: state.revision,
    }).state;
    const retried = apply(failed, {
      type: "retry",
      generationId: "generation-retry-2",
      expectedRevision: failed.revision,
    }).state;
    expect(retried.hintLevel).toBe(2);
  });

  it("does not persist a partial character reply when the stream fails without done", () => {
    let state = readyState();
    state = apply(state, {
      type: "submit-typing",
      attemptId: ids.attempt,
      generationId: ids.generation,
      expectedRevision: state.revision,
      text: "Quisiera la sopa.",
    }).state;
    state = apply(state, {
      type: "user-turn-persisted",
      expectedRevision: state.revision,
      turnId: ids.userTurn,
    }).state;
    state = apply(state, {
      type: "roleplay-delta",
      generationId: ids.generation,
      text: "Lo siento, se ha",
    }).state;
    const failure = apply(state, {
      type: "roleplay-failed",
      generationId: ids.generation,
      expectedRevision: state.revision,
      code: "provider-timeout",
    });

    expect(failure.state.status).toBe("recoverable-error");
    expect(failure.effects.map((effect) => effect.type)).not.toContain(
      "persistCompletedRoleplayTurn",
    );
    expect(failure.effects).toContainEqual({
      type: "discardPartialRoleplayReply",
      generationId: ids.generation,
    });
    const retry = apply(failure.state, {
      type: "retry",
      generationId: "generation-retry-roleplay",
      expectedRevision: failure.state.revision,
    });
    expect(retry.state.status).toBe("awaiting-roleplay-reply");
    expect(retry.effects).toEqual([{
      type: "requestRoleplayReply",
      generationId: "generation-retry-roleplay",
      replyToTurnId: ids.userTurn,
    }]);
  });

  it("supports pause, completion, pending review, and completed review", () => {
    let state = readyState();
    state = apply(state, {
      type: "pause",
      expectedRevision: state.revision,
    }).state;
    expect(state.status).toBe("paused");
    state = apply(state, {
      type: "resume",
      expectedRevision: state.revision,
    }).state;
    expect(state.status).toBe("awaiting-expression");

    let result = apply(state, {
      type: "complete-session",
      expectedRevision: state.revision,
    });
    state = result.state;
    expect(state.status).toBe("completed");
    expect(result.effects).toEqual([{ type: "finalizeSession" }]);

    result = apply(state, {
      type: "session-finalized",
      expectedRevision: state.revision,
    });
    state = result.state;
    expect(state.status).toBe("review-pending");
    expect(result.effects).toEqual([{ type: "requestEvaluation" }]);

    state = apply(state, {
      type: "review-completed",
      expectedRevision: state.revision,
    }).state;
    expect(state.status).toBe("review-ready");
  });
});
