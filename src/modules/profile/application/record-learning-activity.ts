import { z } from "zod";

import type { ProfileRepository } from "../repositories/profile-repository";

export const recordLearningActivityInputSchema = z.object({
  clientInstanceId: z.string().min(1).max(128),
  eventType: z.enum(["active", "inactive", "ended"]),
  sequence: z.number().int().nonnegative(),
});

export type RecordLearningActivityInput = z.infer<
  typeof recordLearningActivityInputSchema
>;

export class LearningActivitySessionNotFoundError extends Error {
  constructor() {
    super("learning-activity-session-not-found");
    this.name = "LearningActivitySessionNotFoundError";
  }
}

export class LearningActivitySessionClosedError extends Error {
  constructor() {
    super("learning-activity-session-closed");
    this.name = "LearningActivitySessionClosedError";
  }
}

export async function recordLearningActivity(
  repository: ProfileRepository,
  userId: string,
  sessionId: string,
  input: RecordLearningActivityInput,
): Promise<{ status: "duplicate" | "inserted" }> {
  const result = await repository.appendActivityEvent(userId, sessionId, {
    clientInstanceId: input.clientInstanceId,
    eventType: input.eventType,
    sequence: input.sequence,
  });
  if (result === "not-found") throw new LearningActivitySessionNotFoundError();
  if (result === "closed") throw new LearningActivitySessionClosedError();
  return { status: result };
}
