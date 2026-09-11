import type { ScenarioRepetitionResult } from "../domain";
import type { ScenarioPracticeRepository } from "../repositories";

export async function completeScenarioRepetition(repository: ScenarioPracticeRepository, input: Readonly<{
  userId: string;
  repetitionId: string;
  completionKey: string;
  result: ScenarioRepetitionResult;
  now?: () => Date;
}>) {
  const item = await repository.getRepetitionItem(input.userId, input.repetitionId);
  if (!item) throw new Error("SCENARIO_REPETITION_NOT_FOUND");
  if (input.result === "technical-failure") {
    return { status: "retry-required" as const, reason: "technical-failure" as const, item };
  }
  const completed = await repository.completeRepetitionItem(input.userId, input.repetitionId, {
    completionKey: input.completionKey,
    completedAt: (input.now ?? (() => new Date()))(),
    result: input.result,
  });
  return { status: "completed" as const, item: completed };
}
