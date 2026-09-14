import { z } from "zod";

export const lexicalIntentSchema = z.enum(["familiar", "revisit", "ignore"]);
export const lexiconEntryKindSchema = z.enum(["lexeme", "phrase"]);

export const vocabularyQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  intent: lexicalIntentSchema.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

export const phraseQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  intent: lexicalIntentSchema.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

export const setLexicalIntentSchema = z.object({
  entryKind: lexiconEntryKindSchema,
  intent: lexicalIntentSchema,
  expectedRevision: z.number().int().positive().optional(),
});

export const corpusQuerySchema = z.object({
  query: z.string().trim().min(1).max(120),
  documentKind: z.enum(["article", "media"]).optional(),
  sourceKind: z.string().trim().max(80).optional(),
  stableKey: z.string().trim().max(240).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const lexicalAssessmentAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(500),
});

export const lexicalAssessmentKeySchema = z.string().trim().min(1).max(240);
export const idempotencyKeySchema = z.string().trim().min(8).max(128);

export type VocabularyQuery = z.infer<typeof vocabularyQuerySchema>;
export type PhraseQuery = z.infer<typeof phraseQuerySchema>;
export type LexicalIntent = z.infer<typeof lexicalIntentSchema>;
export type LexiconEntryKind = z.infer<typeof lexiconEntryKindSchema>;
export type CorpusQueryInput = z.infer<typeof corpusQuerySchema>;
export type LexicalAssessmentAnswer = z.infer<typeof lexicalAssessmentAnswerSchema>;
