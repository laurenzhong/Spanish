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

export type VocabularyQuery = z.infer<typeof vocabularyQuerySchema>;
export type PhraseQuery = z.infer<typeof phraseQuerySchema>;
export type LexicalIntent = z.infer<typeof lexicalIntentSchema>;
export type LexiconEntryKind = z.infer<typeof lexiconEntryKindSchema>;
