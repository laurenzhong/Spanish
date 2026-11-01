import { z } from "zod";
import { normalizeSpanishSurface } from "../domain/spanish-token";

export const vocabularyMarkStatusSchema = z.enum(["familiar", "learning", "revisit", "ignore"]);
export type VocabularyMarkStatus = z.infer<typeof vocabularyMarkStatusSchema>;
export type VocabularyMarks = Record<string, VocabularyMarkStatus | null>;

export const vocabularyMarkWordSchema = z.string().trim().min(1).max(120)
  .refine((word) => !/[\u0000-\u001f\u007f]/u.test(word), "Control characters are not word keys")
  .transform(normalizeSpanishSurface)
  .pipe(z.string().min(1).max(120));
export const vocabularyMarkWriteSchema = z.object({
  word: vocabularyMarkWordSchema,
  status: vocabularyMarkStatusSchema.nullable(),
}).strict();

export const vocabularyMarkImportSchema = z.object({
  marks: z.record(z.string().min(1).max(120), vocabularyMarkStatusSchema)
    .refine((marks) => Object.keys(marks).length <= 10_000, "At most 10000 marks")
    .transform((marks, context) => {
      const result: Record<string, VocabularyMarkStatus> = Object.create(null);
      for (const [word, status] of Object.entries(marks)) {
        const parsed = vocabularyMarkWordSchema.safeParse(word);
        if (!parsed.success || (Object.hasOwn(result, parsed.data) && result[parsed.data] !== status)) {
          context.addIssue({ code: "custom", message: "Invalid or conflicting normalized word" });
          return z.NEVER;
        }
        result[parsed.data] = status;
      }
      return result;
    }),
}).strict();

export const vocabularyMarksResponseSchema = z.object({
  marks: z.record(z.string(), vocabularyMarkStatusSchema.nullable()),
}).strict();
