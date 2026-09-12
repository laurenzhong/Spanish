import type { ScenarioRoleplayInput, ScenarioRoleplayProvider } from "@/src/modules/providers/scenario-roleplay";
import { ScenarioProviderError } from "@/src/modules/providers/scenario-roleplay";
import { streamWithScenarioProviderFallback } from "@/src/modules/providers/routing/provider-fallback";

import type { ScenarioPracticeDetail } from "../content";

export type ScenarioReplyFrame =
  | Readonly<{ type: "meta"; generationId: string; provider: string }>
  | Readonly<{ type: "condition"; stableKey: string; text: string }>
  | Readonly<{ type: "delta"; generationId: string; text: string }>
  | Readonly<{ type: "done"; generationId: string }>;

export async function* streamScenarioReply(input: Readonly<{
  provider: ScenarioRoleplayProvider | readonly ScenarioRoleplayProvider[];
  scenario: ScenarioPracticeDetail;
  requestId: string;
  sessionId: string;
  generationId: string;
  completedTurns: ScenarioRoleplayInput["completedTurns"];
  triggeredConditions: readonly string[];
  signal?: AbortSignal;
}>): AsyncIterable<ScenarioReplyFrame> {
  const completedUserTurns = input.completedTurns.filter((turn) => turn.speaker === "user").length;
  const alreadyTriggered = new Set(input.triggeredConditions);
  const condition = input.scenario.conditions.find((candidate) =>
    candidate.afterUserTurns <= completedUserTurns && !alreadyTriggered.has(candidate.stableKey),
  );
  const conditionSnapshot = [
    ...input.triggeredConditions.flatMap((key) => {
      const found = input.scenario.conditions.find((candidate) => candidate.stableKey === key);
      return found ? [found.characterLine] : [];
    }),
    ...(condition ? [condition.characterLine] : []),
  ];
  let didFinish = false;
  let announcedProvider: string | null = null;
  const providers: readonly ScenarioRoleplayProvider[] = Array.isArray(input.provider)
    ? input.provider
    : [input.provider as ScenarioRoleplayProvider];
  for await (const { provider, event } of streamWithScenarioProviderFallback({
    providers,
    stream: (activeProvider) => activeProvider.stream({
      requestId: input.requestId,
      sessionId: input.sessionId,
      generationId: input.generationId,
      temporaryCharacter: {
        displayName: input.scenario.temporaryCharacter.displayName,
        role: input.scenario.temporaryCharacter.role,
        locale: input.scenario.temporaryCharacter.locale,
      },
      communicationGoal: input.scenario.tasks.map((task) => task.prompt).join("；"),
      conditionSnapshot,
      completedTurns: input.completedTurns,
    }, { signal: input.signal }),
    isTerminal: (event) => event.type === "done",
    incompleteError: () => new ScenarioProviderError(
      "provider-unavailable",
      "Scenario roleplay stream ended before done.",
      true,
    ),
  })) {
    if (event.generationId !== input.generationId) continue;
    if (announcedProvider !== provider.key) {
      announcedProvider = provider.key;
      yield { type: "meta", generationId: input.generationId, provider: provider.key };
      if (condition) yield { type: "condition", stableKey: condition.stableKey, text: condition.prompt };
    }
    if (event.type === "delta") yield event;
    if (event.type === "done") { didFinish = true; yield event; }
  }
  if (!didFinish) throw new Error("SCENARIO_REPLY_INCOMPLETE");
}
