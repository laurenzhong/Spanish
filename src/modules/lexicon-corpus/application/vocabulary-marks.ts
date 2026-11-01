import type { VocabularyMarksRepository } from "../repositories/vocabulary-marks-repository";
import { vocabularyMarkImportSchema, vocabularyMarkWriteSchema, vocabularyMarksResponseSchema } from "../schemas/vocabulary-marks";

export async function readVocabularyMarks(repository: VocabularyMarksRepository, userId: string) {
  return vocabularyMarksResponseSchema.parse({ marks: await repository.read(userId) });
}

export async function setVocabularyMark(repository: VocabularyMarksRepository, userId: string, input: unknown) {
  const { word, status } = vocabularyMarkWriteSchema.parse(input);
  return vocabularyMarksResponseSchema.parse({ marks: await repository.set(userId, word, status) });
}

export async function importVocabularyMarks(repository: VocabularyMarksRepository, userId: string, input: unknown) {
  const { marks } = vocabularyMarkImportSchema.parse(input);
  return vocabularyMarksResponseSchema.parse({ marks: await repository.importMissing(userId, marks) });
}
