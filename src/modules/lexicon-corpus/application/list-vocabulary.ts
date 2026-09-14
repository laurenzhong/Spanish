import type { LexiconCorpusRepository } from "../repositories/lexicon-corpus-repository";
import { vocabularyQuerySchema, type VocabularyQuery } from "../schemas/lexicon";

export async function listVocabulary(repository: LexiconCorpusRepository, userId: string | undefined, input: VocabularyQuery) {
  return repository.listVocabulary(userId, vocabularyQuerySchema.parse(input));
}
