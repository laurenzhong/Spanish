import { buildScenarioReview } from "./build-scenario-review";
import type { ScenarioPracticeRepository } from "../repositories";

export async function getScenarioSessionReview(repository: ScenarioPracticeRepository, userId: string, sessionId: string) {
  const session = await repository.getSession(userId, sessionId);
  if (!session) throw new Error("SCENARIO_SESSION_NOT_FOUND");
  const [turns, reviews, repetitions] = await Promise.all([
    repository.listTurns(userId, sessionId),
    repository.listTurnReviews(userId, sessionId),
    repository.listRepetitionItems(userId, sessionId),
  ]);
  return buildScenarioReview({ session, turns, reviews, repetitions });
}
