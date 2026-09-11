import type { ScenarioPracticeRepository } from "../repositories";

export async function prepareReviewedTurnRetry(repository: ScenarioPracticeRepository, input: Readonly<{
  userId: string;
  sourceSessionId: string;
  turnId: string;
  scenarioKey: string;
}>) {
  const [session, turn] = await Promise.all([
    repository.getSession(input.userId, input.sourceSessionId),
    repository.getTurn(input.userId, input.sourceSessionId, input.turnId),
  ]);
  if (!session || session.status !== "completed" || session.scenarioKey !== input.scenarioKey || !turn || turn.speaker !== "user" || turn.status !== "completed") {
    throw new Error("SCENARIO_TURN_CONFLICT");
  }
  return { sourceSessionId: session.sessionId, turnId: turn.id, originalText: turn.text } as const;
}
