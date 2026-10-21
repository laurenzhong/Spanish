import { z } from "zod";

export const expressionAssistRequestSchema = z.object({
  text: z.string().max(2_000).trim().min(1),
  characterVersion: z.number().int().positive(),
  attemptId: z.string().max(128).trim().min(1),
}).strict();

export const expressionAssistDataSchema = z.object({
  text: z.string().max(2_000).trim().min(1),
  attemptId: z.string().max(128).trim().min(1),
}).strict();

export const expressionAssistResponseSchema = z.object({
  apiVersion: z.literal("v1"),
  data: expressionAssistDataSchema,
}).strict();

export type ExpressionAssistRequest = z.infer<typeof expressionAssistRequestSchema>;
export type ExpressionAssistData = z.infer<typeof expressionAssistDataSchema>;
