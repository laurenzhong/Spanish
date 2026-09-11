import {
  createRepetitionSchedule,
  type ScenarioRepetitionItem,
} from "../domain";
import type { ScenarioPracticeRepository } from "../repositories";

export async function completeScenarioSession(
  repository: ScenarioPracticeRepository,
  input: Readonly<{
    userId: string;
    sessionId: string;
    expectedRevision: number;
    idempotencyKey: string;
    expressionSnapshot: readonly string[];
    goalSnapshot: string;
    variantRequirements: ScenarioRepetitionItem["variantRequirements"];
    now: () => Date;
    makeRepetitionId: (step: 0 | 1 | 2 | 3) => string;
  }>,
) {
  const existing = await repository.getSession(input.userId, input.sessionId);
  if (!existing) throw new Error("SCENARIO_SESSION_NOT_FOUND");
  if (existing.completionIdempotencyKey) {
    if (existing.completionIdempotencyKey !== input.idempotencyKey) throw new Error("SCENARIO_SESSION_CONFLICT");
    return { session: existing, repetitionItems: await repository.listRepetitionItems(input.userId, input.sessionId) } as const;
  }
  const completedAt = input.now();
  const repetitionItems = createRepetitionSchedule({
    userId: input.userId,
    sourceSessionId: input.sessionId,
    baseIdempotencyKey: input.idempotencyKey,
    expressionSnapshot: input.expressionSnapshot,
    goalSnapshot: input.goalSnapshot,
    variantRequirements: input.variantRequirements,
    now: () => completedAt,
    makeId: input.makeRepetitionId,
  });
  const session = await repository.completeSession({
    userId: input.userId,
    sessionId: input.sessionId,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    completedAt,
    repetitionItems,
  });
  const refreshed = await repository.getSession(input.userId, input.sessionId);
  return { session: refreshed ?? session, repetitionItems } as const;
}
