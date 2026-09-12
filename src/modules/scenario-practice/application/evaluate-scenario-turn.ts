import type { ScenarioEvaluationInput, ScenarioEvaluationProvider } from "@/src/modules/providers/scenario-evaluation";
import { executeWithScenarioProviderFallback } from "@/src/modules/providers/routing/provider-fallback";

import type { ScenarioPracticeDetail } from "../content";

export function evaluateScenarioTurn(input: Readonly<{
  provider: ScenarioEvaluationProvider | readonly ScenarioEvaluationProvider[];
  scenario: ScenarioPracticeDetail;
  requestId: string;
  sessionId: string;
  generationId: string;
  modality: "speech" | "typing";
  hintLevel: 0 | 1 | 2 | 3;
  transcriptConfidence: number | null;
  completedTurns: ScenarioEvaluationInput["completedTurns"];
  signal?: AbortSignal;
}>) {
  const providers: readonly ScenarioEvaluationProvider[] = Array.isArray(input.provider)
    ? input.provider
    : [input.provider as ScenarioEvaluationProvider];
  return executeWithScenarioProviderFallback({
    providers,
    execute: (provider) => provider.evaluate({
      requestId: input.requestId,
      sessionId: input.sessionId,
      generationId: input.generationId,
      communicationGoal: input.scenario.tasks.map((task) => task.prompt).join("；"),
      modality: input.modality,
      hintLevel: input.hintLevel,
      transcriptConfidence: input.transcriptConfidence,
      completedTurns: input.completedTurns,
    }, { signal: input.signal }),
  }).then(({ result }) => result);
}
