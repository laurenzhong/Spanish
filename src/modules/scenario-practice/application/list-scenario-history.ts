import type { ScenarioPracticeRepository } from "../repositories";

export async function listScenarioHistory(
  repository: ScenarioPracticeRepository,
  userId: string,
  options: Readonly<{ limit?: number; before?: Date }> = {},
) {
  return repository.listHistory(userId, Math.min(50, Math.max(1, options.limit ?? 20)), options.before);
}
