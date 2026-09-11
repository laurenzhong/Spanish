import { z } from "zod";

import { ScenarioProviderError } from "../routing/scenario-provider-router";

export type ScenarioEvaluationInput = Readonly<{
  requestId: string;
  sessionId: string;
  generationId: string;
  communicationGoal: string;
  modality: "speech" | "typing";
  hintLevel: 0 | 1 | 2 | 3;
  transcriptConfidence: number | null;
  completedTurns: readonly Readonly<{
    turnId: string;
    speaker: "user" | "temporary-character" | "condition";
    text: string;
  }>[];
}>;

export const scenarioEvaluationResultSchema = z.strictObject({
  contextualSuccess: z.boolean(),
  errors: z.array(z.strictObject({
    turnId: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    category: z.string().min(1),
    explanation: z.string().min(1),
    affectsUnderstanding: z.boolean(),
    naturalAlternative: z.string().min(1).nullable(),
  })),
  provider: z.string().min(1),
  modelVersion: z.string().min(1),
  providerRequestId: z.string().nullable(),
  latencyMs: z.number().nonnegative(),
  estimatedCostMicros: z.number().int().nonnegative().nullable(),
});

export type ScenarioEvaluationResult = z.infer<typeof scenarioEvaluationResultSchema>;

export interface ScenarioEvaluationProvider {
  readonly key: string;
  evaluate(
    input: ScenarioEvaluationInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ScenarioEvaluationResult>;
}

export { ScenarioProviderError };
