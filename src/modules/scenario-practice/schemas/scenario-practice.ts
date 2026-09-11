import { z } from "zod";

const uuid = z.string().uuid();
const id = z.string().trim().min(1).max(128);

export const createScenarioSessionRequestSchema = z.strictObject({
  clientAttemptId: id,
  contentVersion: z.number().int().positive(),
  primaryModality: z.enum(["speech", "typing"]),
  scenarioId: uuid.optional(),
  personalScenarioId: uuid.optional(),
}).refine((value) => Boolean(value.scenarioId) !== Boolean(value.personalScenarioId), {
  message: "Exactly one scenario source is required.",
});

export const submitScenarioTurnRequestSchema = z.strictObject({
  attemptId: id,
  expectedRevision: z.number().int().positive(),
  generationId: id,
  hintLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  modality: z.enum(["speech", "typing"]),
  text: z.string().trim().min(1).max(2_000),
  transcriptConfidence: z.number().min(0).max(1).nullable().optional(),
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
