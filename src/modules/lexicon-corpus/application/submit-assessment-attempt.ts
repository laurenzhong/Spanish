import { createHash } from "node:crypto";

import type { LexiconCorpusRepository } from "../repositories/lexicon-corpus-repository";
import { idempotencyKeySchema, lexicalAssessmentAnswerSchema, lexicalAssessmentKeySchema } from "../schemas/lexicon";

function requestHash(assessmentKey: string, answer: string): string {
  return createHash("sha256").update(JSON.stringify({ assessmentKey, answer })).digest("hex");
}

export async function submitAssessmentAttempt(
  repository: LexiconCorpusRepository,
  userId: string,
  assessmentKey: string,
  input: unknown,
  idempotencyKey: string,
) {
  const parsedKey = lexicalAssessmentKeySchema.parse(assessmentKey);
  const parsedIdempotencyKey = idempotencyKeySchema.parse(idempotencyKey);
  const parsed = lexicalAssessmentAnswerSchema.parse(input);
  return repository.submitAssessment(userId, parsedKey, {
    answer: parsed.answer,
    idempotencyKey: parsedIdempotencyKey,
    requestHash: requestHash(parsedKey, parsed.answer),
  });
}
