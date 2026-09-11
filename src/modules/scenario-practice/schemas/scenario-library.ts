import { z } from "zod";

const identifier = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._-]+$/u);
const uuid = z.string().uuid();

export const savedExpressionSourceSchema = z.discriminatedUnion("sourceType", [
  z.strictObject({ sourceType: z.literal("formal-expression"), expressionKey: z.string().trim().min(1).max(160), version: z.number().int().positive() }),
  z.strictObject({ sourceType: z.literal("reading-selection"), highlightId: uuid }),
  z.strictObject({ sourceType: z.literal("scenario-review"), reviewId: uuid }),
  z.strictObject({ sourceType: z.literal("manual"), text: z.string().trim().min(1).max(1_000), translation: z.string().trim().min(1).max(1_000).optional() }),
]);

export const saveExpressionRequestSchema = z.strictObject({ clientSaveId: identifier, source: savedExpressionSourceSchema });

export const generationSourceSchema = z.discriminatedUnion("sourceType", [
  z.strictObject({ sourceType: z.literal("topic"), topic: z.string().trim().min(2).max(200) }),
  z.strictObject({ sourceType: z.literal("reading"), sourceId: uuid }),
  z.strictObject({ sourceType: z.literal("saved-expression"), sourceId: uuid }),
  z.strictObject({ sourceType: z.literal("recent-error"), sourceId: uuid }),
]);

export const generatePersonalScenarioRequestSchema = z.strictObject({
  requestId: identifier,
  generationId: identifier,
  cefr: z.enum(["A1", "A2", "B1", "B2"]),
  locale: z.enum(["es-ES", "es-MX"]),
  source: generationSourceSchema,
});
