import { z } from "zod";

/**
 * CHAT-ASSISTANT-001: the private, transient in-chat learning assistant.
 *
 * The learner opens "AI 助手" from the chat header menu and asks it to help
 * reply, check the grammar of a draft, analyse a sentence, or explain an
 * expression. Nothing here is persisted: the panel is a view over one
 * authenticated provider call, and no message, memory, relationship or
 * learning evidence is written.
 *
 * The request carries only what the learner chose to ask or check. Recent
 * conversation context is read server-side from the learner's own completed,
 * non-withdrawn messages; it never comes from the client.
 */
export const conversationAssistantIntents = [
  /** Suggest one or more natural Spanish replies to the current conversation. */
  "reply",
  /** Check the learner's own Spanish draft for grammar mistakes. */
  "grammar",
  /** Break a Spanish sentence into its syntactic constituents. */
  "structure",
  /** Answer a free-form learning question about the conversation/expression. */
  "question",
] as const;

export type ConversationAssistantIntent = (typeof conversationAssistantIntents)[number];

const attemptId = z.string().max(128).trim().min(1);
const characterVersion = z.number().int().positive();

export const conversationAssistantRequestSchema = z
  .object({
    intent: z.enum(conversationAssistantIntents),
    characterVersion,
    attemptId,
    /** Free-form question; required for the `question` intent. */
    question: z.string().max(800).trim().optional(),
    /** Sentence to check or analyse; required for `grammar`. */
    targetText: z.string().max(2_000).trim().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.intent === "question" && !value.question) {
      context.addIssue({ code: "custom", path: ["question"], message: "A question is required." });
    }
    if (value.intent === "grammar" && !value.targetText) {
      context.addIssue({ code: "custom", path: ["targetText"], message: "A sentence to check is required." });
    }
  });

const suggestionSchema = z.object({
  /** Natural es-ES expression the learner can put into the composer. */
  spanish: z.string().max(1_000).trim().min(1),
  /** Short Simplified-Chinese gloss of that expression. */
  chinese: z.string().max(1_000).trim().min(1),
}).strict();

const correctionSchema = z.object({
  original: z.string().max(1_000).trim().min(1),
  corrected: z.string().max(1_000).trim().min(1),
  explanation: z.string().max(1_000).trim().min(1),
}).strict();

const structurePartSchema = z.object({
  fragment: z.string().max(500).trim().min(1),
  /** Simplified Chinese name, e.g. 主语 / 谓语 / 直接宾语 / 状语. */
  role: z.string().max(120).trim().min(1),
  explanation: z.string().max(1_000).trim().min(1),
}).strict();

/**
 * Provider-independent result. Only `answer` is mandatory: a reply may come
 * back without usable suggestions and a grammar answer may only explain the
 * mistakes, so the UI must never depend on one optional block being present.
 */
export const conversationAssistantDataSchema = z.object({
  attemptId,
  intent: z.enum(conversationAssistantIntents),
  /** Simplified Chinese explanation, the core of every answer. */
  answer: z.string().max(4_000).trim().min(1),
  suggestions: z.array(suggestionSchema).max(3).default([]),
  corrections: z.array(correctionSchema).max(8).default([]),
  structure: z.array(structurePartSchema).max(12).default([]),
  correctedSentence: z.string().max(2_000).trim().nullable().default(null),
}).strict();

export const conversationAssistantResponseSchema = z.object({
  apiVersion: z.literal("v1"),
  data: conversationAssistantDataSchema,
}).strict();

export type ConversationAssistantRequest = z.infer<typeof conversationAssistantRequestSchema>;
export type ConversationAssistantData = z.infer<typeof conversationAssistantDataSchema>;
export type ConversationAssistantSuggestion = z.infer<typeof suggestionSchema>;
