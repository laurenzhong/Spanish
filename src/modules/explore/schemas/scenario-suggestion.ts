import { z } from "zod";

import { scenarioSuggestionModes, scenarioSuggestionReasonCodes } from "../domain/scenario-suggestion";

const identifier = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._-]+$/u);

export const scenarioSuggestionRequestSchema = z.strictObject({
  mode: z.enum(scenarioSuggestionModes),
  suggestionSessionId: identifier,
  requestId: identifier,
  excludedScenarioIds: z.array(z.string().trim().min(1).max(160)).max(5).refine((items) => new Set(items).size === items.length).default([]),
  category: z.string().trim().min(1).max(80).optional(),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).optional(),
  modality: z.enum(["speech", "typing"]).optional(),
});

export type ScenarioSuggestionRequest = z.infer<typeof scenarioSuggestionRequestSchema>;

const candidateSchema = z.strictObject({
  stableKey: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
  category: z.string().min(1),
  categoryLabel: z.string().min(1),
  role: z.string().min(1),
  communicationGoal: z.string().min(1),
  sourceKind: z.enum(["public", "personal"]),
  route: z.string().min(1),
});

export const scenarioSuggestionResponseSchema = z.strictObject({
  apiVersion: z.literal("v1"),
  data: z.strictObject({
    requestId: identifier,
    suggestionSessionId: identifier,
    scenario: candidateSchema.nullable(),
    reasons: z.array(z.strictObject({ code: z.enum(scenarioSuggestionReasonCodes), text: z.string().min(1) })).max(2),
    eligibleCount: z.number().int().nonnegative(),
    canSwap: z.boolean(),
    limitReached: z.boolean(),
    fallback: z.strictObject({
      canGeneratePersonalScenario: z.boolean(),
      topicChips: z.array(z.string().min(1)).min(1).max(6),
    }).nullable(),
  }),
});

export type ScenarioSuggestionResponse = z.infer<typeof scenarioSuggestionResponseSchema>;
