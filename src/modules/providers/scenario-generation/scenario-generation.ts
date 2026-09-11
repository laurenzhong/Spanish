import { z } from "zod";

import { ScenarioProviderError } from "../routing/scenario-provider-router";

export type ScenarioGenerationInput = Readonly<{
  requestId: string;
  generationId: string;
  locale: "es-ES" | "es-MX";
  cefr: "A1" | "A2" | "B1" | "B2";
  topic: string;
  sourceExpressions: readonly string[];
}>;

export const scenarioGenerationResultSchema = z.strictObject({
  title: z.string().min(1).max(120),
  setting: z.string().min(1).max(500),
  communicationGoals: z.array(z.string().min(1).max(300)).min(1).max(5),
  conditionChanges: z.array(z.string().min(1).max(300)).max(5),
  temporaryCharacter: z.strictObject({
    displayName: z.string().min(1).max(80),
    role: z.string().min(1).max(120),
    locale: z.enum(["es-ES", "es-MX"]),
  }),
  provider: z.string().min(1),
  modelVersion: z.string().min(1),
  providerRequestId: z.string().nullable(),
  latencyMs: z.number().nonnegative(),
  estimatedCostMicros: z.number().int().nonnegative().nullable(),
});

export type ScenarioGenerationResult = z.infer<typeof scenarioGenerationResultSchema>;

export interface ScenarioGenerationProvider {
  readonly key: string;
  generate(
    input: ScenarioGenerationInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ScenarioGenerationResult>;
}

export { ScenarioProviderError };
