import { describe, expect, it } from "vitest";

import {
  checkpointFromState,
  parseTrainingCheckpoint,
  restoreTrainingCheckpoint,
  serializeTrainingCheckpoint,
  stateFromTrainingCheckpoint,
  trainingCheckpointStorageKey,
} from "@/src/modules/training/checkpoints";
import { createTrainingState, transition } from "@/src/modules/training/domain";

class MemoryStore {
  value: string | null = null;
  clearCount = 0;

  async read() {
    return this.value;
  }

  async write(serialized: string) {
    this.value = serialized;
  }

  async clear() {
    this.clearCount += 1;
    this.value = null;
  }
}

function awaitingOutputState() {
  let result = transition(createTrainingState(), {
    type: "content-loaded",
    contentKey: "expression.demo",
    goalKey: "goal.demo",
  });
  result = transition(result.state, { type: "input-playback-completed" });
  return result.state;
}

describe("training checkpoints", () => {
  it("only projects stable states and round-trips them", () => {
    const transient = transition(createTrainingState(), {
      type: "content-loaded",
      contentKey: "expression.demo",
      goalKey: "goal.demo",
    }).state;
    expect(checkpointFromState(transient)).toBeNull();

    const state = awaitingOutputState();
    const checkpoint = checkpointFromState(state);
    expect(checkpoint).not.toBeNull();
    expect(stateFromTrainingCheckpoint(checkpoint!)).toEqual(state);
  });

  it("rejects incompatible versions and malformed payloads", () => {
    const state = awaitingOutputState();
    const serialized = serializeTrainingCheckpoint(checkpointFromState(state)!);
    const incompatible = JSON.stringify({
      ...JSON.parse(serialized),
      contentBundleVersion: 99,
    });

    expect(
      parseTrainingCheckpoint(incompatible, {
        contentBundleKey: "alpha.core",
        contentBundleVersion: 1,
      }),
    ).toBeNull();
    expect(parseTrainingCheckpoint("{broken")).toBeNull();
  });

  it("clears a corrupt checkpoint and restores a valid one once", async () => {
    const store = new MemoryStore();
    store.value = "not-json";
    expect(await restoreTrainingCheckpoint(store)).toBeNull();
    expect(store.clearCount).toBe(1);

    const state = awaitingOutputState();
    store.value = serializeTrainingCheckpoint(checkpointFromState(state)!);
    expect(await restoreTrainingCheckpoint(store)).toEqual(state);
    expect(store.clearCount).toBe(1);
  });

  it("keeps checkpoint keys isolated by user id", () => {
    expect(trainingCheckpointStorageKey("user/a")).not.toBe(
      trainingCheckpointStorageKey("user/b"),
    );
    expect(trainingCheckpointStorageKey("user/a")).toContain("user%2Fa");
  });
});
