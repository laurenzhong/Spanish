import { z } from "zod";

import type { TemporaryCharacterSnapshot } from "../../scenario-practice";
import { ScenarioProviderError } from "../routing/scenario-provider-router";

export type ScenarioRoleplayInput = Readonly<{
  requestId: string;
  sessionId: string;
  generationId: string;
  temporaryCharacter: TemporaryCharacterSnapshot;
  communicationGoal: string;
  conditionSnapshot: readonly string[];
  completedTurns: readonly Readonly<{
    speaker: "user" | "temporary-character" | "condition";
    text: string;
  }>[];
}>;

export const scenarioRoleplayStreamEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("delta"), generationId: z.string().min(1), text: z.string().min(1) }),
  z.strictObject({ type: z.literal("done"), generationId: z.string().min(1) }),
]);

export type ScenarioRoleplayStreamEvent = z.infer<typeof scenarioRoleplayStreamEventSchema>;

export interface ScenarioRoleplayProvider {
  readonly key: string;
  readonly modelVersion?: string;
  stream(
    input: ScenarioRoleplayInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): AsyncIterable<ScenarioRoleplayStreamEvent>;
}

export { ScenarioProviderError };
