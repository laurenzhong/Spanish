import { z } from "zod";

const uuid = z.string().uuid();
const id = z.string().trim().min(1).max(128);

export const createScenarioSessionRequestSchema = z.strictObject({
  sessionId: uuid,
  clientAttemptId: id,
  primaryModality: z.enum(["speech", "typing"]),
  scenarioKey: z.string().trim().min(1).max(160),
});

export const submitScenarioTurnRequestSchema = z.strictObject({
  id: uuid,
  clientAttemptId: id,
  turnIndex: z.number().int().nonnegative(),
  attemptId: id,
  generationId: id,
  modality: z.enum(["speech", "typing"]),
  text: z.string().trim().min(1).max(2_000),
});

export const scenarioTransitionFixtureSchema = z.strictObject({
  protocolVersion: z.literal("v1"),
  cases: z.array(z.strictObject({
    name: z.string().min(1),
    from: z.string().min(1),
    event: z.string().min(1),
    to: z.string().min(1),
    effects: z.array(z.string().min(1)),
  })).min(1),
});

export function parseCreateScenarioSessionRequest(input: unknown) {
  return createScenarioSessionRequestSchema.parse(input);
}

export function parseSubmitScenarioTurnRequest(input: unknown) {
  return submitScenarioTurnRequestSchema.parse(input);
}
