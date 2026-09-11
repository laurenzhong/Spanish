import type { ScenarioPracticeRepository } from "../repositories";

export async function submitScenarioTurn(
  repository: ScenarioPracticeRepository,
  input: Parameters<ScenarioPracticeRepository["appendCompletedUserTurn"]>[0],
) {
  const session = await repository.getSession(input.userId, input.sessionId);
  if (!session) throw new Error("SCENARIO_SESSION_NOT_FOUND");
  const turn = await repository.appendCompletedUserTurn(input);
  return {
    turn,
    roleplayRequest: {
      generationId: input.generationId,
      replyToTurnId: turn.id,
      sessionId: input.sessionId,
    },
  } as const;
}

export async function persistCompletedScenarioRoleplayTurn(
  repository: ScenarioPracticeRepository,
  input: Parameters<ScenarioPracticeRepository["appendCompletedRoleplayTurn"]>[0],
) {
  if (!input.done) throw new Error("SCENARIO_REPLY_INCOMPLETE");
  return repository.appendCompletedRoleplayTurn(input);
}
