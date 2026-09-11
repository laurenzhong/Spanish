import type { ScenarioEvaluationInput, ScenarioEvaluationProvider } from "@/src/modules/providers/scenario-evaluation";

import type { ScenarioPracticeDetail } from "../content";

export function evaluateScenarioTurn(input: Readonly<{
  provider: ScenarioEvaluationProvider;
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
  return input.provider.evaluate({
    requestId: input.requestId,
    sessionId: input.sessionId,
    generationId: input.generationId,
    communicationGoal: input.scenario.tasks.map((task) => task.prompt).join("；"),
    modality: input.modality,
    hintLevel: input.hintLevel,
    transcriptConfidence: input.transcriptConfidence,
    completedTurns: input.completedTurns,
  }, { signal: input.signal });
}
