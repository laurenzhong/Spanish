import type { ScenarioPracticeRepository } from "../repositories";

export async function restoreScenarioSession(
  repository: ScenarioPracticeRepository,
  userId: string,
  sessionId: string,
) {
  const session = await repository.getSession(userId, sessionId);
  if (!session) throw new Error("SCENARIO_SESSION_NOT_FOUND");
  return session;
}
