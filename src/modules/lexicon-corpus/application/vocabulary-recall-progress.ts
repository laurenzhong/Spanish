import type { VocabularyRecallProgressRepository } from "../repositories/vocabulary-recall-progress-repository";
import { vocabularyRecallProgressResponseSchema, vocabularyRecallProgressWriteSchema } from "../schemas/vocabulary-recall-progress";

export async function readVocabularyRecallProgress(repository: VocabularyRecallProgressRepository, userId: string) {
  return vocabularyRecallProgressResponseSchema.parse(await repository.read(userId));
}

export async function saveVocabularyRecallProgress(repository: VocabularyRecallProgressRepository, userId: string, input: unknown, now = new Date()) {
  const parsed = vocabularyRecallProgressWriteSchema.parse(input);
  return vocabularyRecallProgressResponseSchema.parse(await repository.save(userId, parsed, now));
}
