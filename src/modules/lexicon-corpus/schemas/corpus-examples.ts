import { z } from "zod";

export const corpusExamplesQuerySchema = z.object({
  query: z.string().trim().max(120).default(""),
  match: z.enum(["phrase", "all"]).default("phrase"),
  contentKind: z.enum(["article", "video", "podcast"]).optional(),
  documentKind: z.enum(["article", "media"]).optional(),
  stableKey: z.string().trim().max(240).optional(),
  sourceKind: z.string().trim().max(80).optional(),
  entryKind: z.enum(["lexeme", "phrase"]).optional(),
  entryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(24).default(12),
}).superRefine((value, context) => {
  if (Boolean(value.entryId) !== Boolean(value.entryKind)) context.addIssue({ code: "custom", message: "entryKind and entryId must be provided together." });
});

export const corpusExampleSchema = z.object({
  id: z.string(),
  text: z.string(),
  translation: z.string().nullable(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  sourceTitle: z.string(),
  sourceName: z.string(),
  contentKind: z.enum(["article", "video", "podcast"]),
  document: z.object({ kind: z.enum(["article", "media"]), stableKey: z.string(), version: z.number().int().positive() }),
  location: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), paragraphId: z.string(), segmentIndex: z.number().int().nonnegative() }),
    z.object({ kind: z.literal("media"), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), segmentIndex: z.number().int().nonnegative() }),
  ]),
});

export const corpusExamplesPageSchema = z.object({
  items: z.array(corpusExampleSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

export type CorpusExamplesQuery = z.infer<typeof corpusExamplesQuerySchema>;
export type CorpusExampleItem = z.infer<typeof corpusExampleSchema>;
export type CorpusExamplesPage = z.infer<typeof corpusExamplesPageSchema>;
