import { describe, expect, it, vi } from "vitest";

import {
  LearningActivitySessionClosedError,
  LearningActivitySessionNotFoundError,
  recordLearningActivity,
  type RecordLearningActivityInput,
} from "@/src/modules/profile/application";
import type { ProfileRepository } from "@/src/modules/profile/repositories";

const input: RecordLearningActivityInput = {
  clientInstanceId: "web-1",
  eventType: "active",
  sequence: 1,
};

function repository(
  result: "closed" | "duplicate" | "inserted" | "not-found",
): ProfileRepository {
  return {
    appendActivityEvent: vi.fn().mockResolvedValue(result),
    listEvidence: vi.fn(),
    listLearningSessions: vi.fn(),
    listSkillStates: vi.fn(),
  };
}

describe("recordLearningActivity", () => {
  it.each(["inserted", "duplicate"] as const)(
    "returns %s without treating an idempotent retry as an error",
    async (status) => {
      await expect(
        recordLearningActivity(repository(status), "user-1", "session-1", input),
      ).resolves.toEqual({ status });
    },
  );

  it("maps missing and closed sessions to stable domain errors", async () => {
    await expect(
      recordLearningActivity(repository("not-found"), "user-1", "session-1", input),
    ).rejects.toBeInstanceOf(LearningActivitySessionNotFoundError);
    await expect(
      recordLearningActivity(repository("closed"), "user-1", "session-1", input),
    ).rejects.toBeInstanceOf(LearningActivitySessionClosedError);
  });
});
