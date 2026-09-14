import { describe, expect, it } from "vitest";

import {
  ContentAcquisitionConflictError,
  InvalidAcquisitionTransitionError,
  transitionCandidateState,
  type CandidateState,
} from "@/src/modules/content-acquisition";

function initialState(): CandidateState {
  return { status: "discovered", revision: 1, generationId: "generation-1" };
}

describe("content acquisition candidate state", () => {
  it("follows the only successful path to owner review", () => {
    let state = initialState();
    for (const type of [
      "screen-approved",
      "start-acquisition",
      "start-processing",
      "mark-review-ready",
    ] as const) {
      state = transitionCandidateState(state, {
        type,
        expectedRevision: state.revision,
        generationId: state.generationId,
      });
    }

    expect(state).toEqual({
      status: "review_ready",
      revision: 5,
      generationId: "generation-1",
    });
  });

  it("rejects every skipped or terminal transition", () => {
    expect(() =>
      transitionCandidateState(initialState(), {
        type: "start-processing",
        expectedRevision: 1,
        generationId: "generation-1",
      }),
    ).toThrow(InvalidAcquisitionTransitionError);

    expect(() =>
      transitionCandidateState(
        { status: "review_ready", revision: 5, generationId: "generation-1" },
        {
          type: "start-processing",
          expectedRevision: 5,
          generationId: "generation-1",
        },
      ),
    ).toThrow(InvalidAcquisitionTransitionError);
  });

  it("retries a failed candidate only with a new generation", () => {
    const failed = transitionCandidateState(initialState(), {
      type: "fail",
      expectedRevision: 1,
      generationId: "generation-1",
    });

    expect(() =>
      transitionCandidateState(failed, {
        type: "retry",
        expectedRevision: failed.revision,
        generationId: "generation-1",
      }),
    ).toThrow(ContentAcquisitionConflictError);

    expect(
      transitionCandidateState(failed, {
        type: "retry",
        expectedRevision: failed.revision,
        generationId: "generation-2",
      }),
    ).toEqual({ status: "discovered", revision: 3, generationId: "generation-2" });
  });

  it("rejects stale revisions and callbacks from old generations", () => {
    expect(() =>
      transitionCandidateState(initialState(), {
        type: "screen-approved",
        expectedRevision: 0,
        generationId: "generation-1",
      }),
    ).toThrow(ContentAcquisitionConflictError);

    expect(() =>
      transitionCandidateState(initialState(), {
        type: "screen-approved",
        expectedRevision: 1,
        generationId: "generation-old",
      }),
    ).toThrow(ContentAcquisitionConflictError);
  });
});
