import { z } from "zod";

export const lexicalIntentSchema = z.enum(["familiar", "revisit", "ignore"]);
export const lexicalIntentFilterSchema = z.enum(["familiar", "revisit", "ignore", "unmarked"]);
export const lexiconEntryKindSchema = z.enum(["lexeme", "phrase"]);
const optionalFilter = <T extends z.ZodType>(schema: T) => z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, schema.optional());

export const vocabularyQuerySchema = z.object({
  search: optionalFilter(z.string().trim().max(80)),
  intent: optionalFilter(lexicalIntentFilterSchema),
  lemmaStatus: optionalFilter(z.enum(["verified", "pending"])),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

export const phraseQuerySchema = z.object({
  search: optionalFilter(z.string().trim().max(120)),
  intent: optionalFilter(lexicalIntentFilterSchema),
  pragmaticPurpose: optionalFilter(z.string().trim().max(80)),
  register: optionalFilter(z.string().trim().max(40)),
  region: optionalFilter(z.string().trim().max(40)),
  cefr: optionalFilter(z.string().trim().max(16)),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

export const setLexicalIntentSchema = z.object({
  entryKind: lexiconEntryKindSchema,
  intent: lexicalIntentSchema,
  expectedRevision: z.number().int().positive().optional(),
});

const corpusQueryObjectSchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  match: z.enum(["phrase", "all"]).default("phrase"),
  entryKind: lexiconEntryKindSchema.optional(),
  entryId: z.string().uuid().optional(),
  documentKind: z.enum(["article", "media"]).optional(),
  sourceKind: z.string().trim().max(80).optional(),
  stableKey: z.string().trim().max(240).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).superRefine((value, context) => {
  if ((value.entryKind && !value.entryId) || (!value.entryKind && value.entryId)) {
    context.addIssue({ code: "custom", message: "entryKind and entryId must be provided together." });
  }
  if (!value.query && !(value.entryKind && value.entryId)) {
    context.addIssue({ code: "custom", message: "A query or exact entry is required." });
  }
});

/** Accept the browser-facing `q` alias while keeping the application DTO named `query`. */
export const corpusQuerySchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const record = input as Record<string, unknown>;
  if (record.query || !record.q) return input;
  const { q, ...rest } = record;
  return { ...rest, query: q };
}, corpusQueryObjectSchema);

export const lexicalAssessmentAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(500),
});

export const lexicalAssessmentKeySchema = z.string().trim().min(1).max(240);
export const idempotencyKeySchema = z.string().trim().min(8).max(128);

export type VocabularyQuery = z.infer<typeof vocabularyQuerySchema>;
export type PhraseQuery = z.infer<typeof phraseQuerySchema>;
export type LexicalIntent = z.infer<typeof lexicalIntentSchema>;
export type LexicalIntentFilter = z.infer<typeof lexicalIntentFilterSchema>;
export type LexiconEntryKind = z.infer<typeof lexiconEntryKindSchema>;
export type CorpusQueryInput = z.infer<typeof corpusQuerySchema>;
export type LexicalAssessmentAnswer = z.infer<typeof lexicalAssessmentAnswerSchema>;
