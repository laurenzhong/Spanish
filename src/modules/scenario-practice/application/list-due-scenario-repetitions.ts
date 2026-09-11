import type { ScenarioPracticeRepository } from "../repositories";

export function listDueScenarioRepetitions(
  repository: ScenarioPracticeRepository,
  userId: string,
  now: () => Date = () => new Date(),
  limit = 20,
) {
  return repository.listDueRepetitionItems(userId, now(), Math.min(50, Math.max(1, limit)));
}
