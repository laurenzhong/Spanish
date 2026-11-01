import { z } from "zod";
import { vocabularyMarkWordSchema } from "./vocabulary-marks";

export const vocabularyRecallProgressEntrySchema = z.object({
  word: vocabularyMarkWordSchema,
  mode: z.enum(["word", "meaning"]),
  result: z.enum(["correct", "accent", "incorrect", "pending"]),
  hinted: z.boolean(),
  selfConfirmed: z.boolean(),
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
}).strict();
export const vocabularyRecallProgressWriteSchema = z.object({
  epoch: z.uuid(),
  attemptId: z.uuid(),
  entries: z.array(vocabularyRecallProgressEntrySchema).min(1).max(20)
    .refine((entries) => new Set(entries.map(({ word, mode }) => JSON.stringify([word, mode]))).size === entries.length, "Duplicate word and mode"),
}).strict();
export const vocabularyRecallProgressSchema = z.object({
  word: z.string().min(1).max(120),
  mode: z.enum(["word", "meaning"]),
  stage: z.enum(["learning", "review"]),
  revision: z.number().int().min(1).max(2_147_483_647),
  successfulReviews: z.number().int().min(0).max(5),
  nextReviewAt: z.iso.datetime().nullable(),
}).strict().refine((value) => value.stage === "learning"
  ? value.nextReviewAt === null && value.successfulReviews === 0
  : value.nextReviewAt !== null && value.successfulReviews >= 1, "Invalid practice stage");
export const vocabularyRecallProgressResponseSchema = z.object({
  epoch: z.uuid(),
  progress: z.array(vocabularyRecallProgressSchema),
}).strict();
export type VocabularyRecallProgressWrite = z.infer<typeof vocabularyRecallProgressWriteSchema>;
export type VocabularyRecallProgressResponse = z.infer<typeof vocabularyRecallProgressResponseSchema>;
export type { VocabularyRecallProgress, VocabularyRecallProgressEntry } from "../domain/vocabulary-recall-progress";
