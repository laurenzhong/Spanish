import { z } from "zod";

const pendingMessageSchema = z.strictObject({
  text: z.string().min(1).max(2_000).refine((text) => Boolean(text.trim())),
  clientMessageId: z.string().min(1).max(200).refine((id) => Boolean(id.trim())),
  assistance: z.literal("translation").optional(),
});
export const conversationStreamRequestSchema = pendingMessageSchema.extend({
  characterVersion: z.number().int().positive().optional(),
  generationId: z.string().min(1).max(128).refine((id) => Boolean(id.trim())),
  pendingMessages: z.array(pendingMessageSchema).max(19).optional(),
  supersedes: z.strictObject({
    generationId: z.string().min(1).max(128).refine((id) => Boolean(id.trim())),
    visibleBubbleCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).optional(),
}).superRefine((input, context) => {
  const ids = [...(input.pendingMessages ?? []).map((message) => message.clientMessageId), input.clientMessageId];
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Batch message identifiers must be unique." });
  if (input.supersedes?.generationId === input.generationId) context.addIssue({ code: "custom", message: "A generation cannot supersede itself." });
});
export type ConversationStreamRequest = z.infer<typeof conversationStreamRequestSchema>;
