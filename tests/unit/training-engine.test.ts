import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  reduceTraining,
  trainingEventFromJson,
  type TrainingEvent,
} from "@/src/modules/training/domain";
import type { TrainingState } from "@/src/modules/training/domain/training-state";

type Fixture = {
  schemaVersion: string;
  cases: Array<{
    id: string;
    events: unknown[];
    expected: {
      state: Record<string, unknown>;
      effects: unknown[];
    };
  }>;
};

const fixture = JSON.parse(
  readFileSync("contracts/fixtures/training/training-transitions.json", "utf8"),
) as Fixture;

function stateSnapshot(state: TrainingState) {
  return {
    status: state.status,
    contentKey: state.contentKey,
    goalKey: state.goalKey,
    outputMode: state.outputMode,
    hintLevel: state.hintLevel,
    generationId: state.generationId,
    transcript: state.transcript,
    evaluation: state.evaluation,
    error: state.error,
  };
}

describe("training engine shared fixtures", () => {
  it.each(fixture.cases)("replays $id", (testCase) => {
    const result = reduceTraining(
      testCase.events.map((event) => trainingEventFromJson(event)) as TrainingEvent[],
    );

    expect(stateSnapshot(result.state)).toEqual(testCase.expected.state);
    expect(result.effects).toEqual(testCase.expected.effects);
  });
});

describe("training engine invariants", () => {
  it("does not turn a technical failure into evaluation evidence", () => {
    const result = reduceTraining([
      { type: "content-loaded", contentKey: "expression.demo", goalKey: "goal.demo" },
      { type: "input-playback-completed" },
      { type: "submit-typing", text: "Hola" },
      {
        type: "evaluation-failed",
        generationId: 2,
        errorCode: "evaluation-timeout",
      },
    ]);

    expect(result.state.status).toBe("recoverable-error");
    expect(result.state.evaluation).toBeNull();
    expect(result.effects).toContainEqual({
      type: "show-error",
      code: "evaluation-timeout",
      technical: true,
    });
  });

  it("ignores a stale evaluation result", () => {
    const result = reduceTraining([
      { type: "content-loaded", contentKey: "expression.demo", goalKey: "goal.demo" },
      { type: "input-playback-completed" },
      { type: "submit-typing", text: "Hola" },
      {
        type: "evaluation-succeeded",
        generationId: 1,
        contextualSuccess: true,
        evidenceStrength: "strong",
        feedbackKey: "stale",
      },
    ]);

    expect(result.state.status).toBe("evaluating");
    expect(result.state.evaluation).toBeNull();
    expect(result.effects[0]).toEqual({
      type: "ignore-stale-result",
      eventType: "evaluation-succeeded",
      generationId: 1,
      currentGenerationId: 2,
    });
  });
});
