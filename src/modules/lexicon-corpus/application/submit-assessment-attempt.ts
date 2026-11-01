import type { LexiconCorpusRepository } from "../repositories/lexicon-corpus-repository";
import { idempotencyKeySchema, lexicalAssessmentAnswerSchema, lexicalAssessmentKeySchema } from "../schemas/lexicon";

async function requestHash(assessmentKey: string, answer: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ assessmentKey, answer }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
    requestHash: await requestHash(parsedKey, parsed.answer),
  });
}
