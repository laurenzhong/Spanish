import type { LexiconCorpusRepository } from "../repositories/lexicon-corpus-repository";
import { phraseQuerySchema, type PhraseQuery } from "../schemas/lexicon";

export async function listPhrases(repository: LexiconCorpusRepository, userId: string | undefined, input: PhraseQuery) {
  return repository.listPhrases(userId, phraseQuerySchema.parse(input));
}
