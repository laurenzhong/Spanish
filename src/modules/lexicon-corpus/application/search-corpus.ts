import type { LexiconCorpusRepository } from "../repositories/lexicon-corpus-repository";
import { corpusQuerySchema } from "../schemas/lexicon";

export async function searchCorpus(repository: LexiconCorpusRepository, userId: string | undefined, input: unknown) {
  return repository.searchCorpus(userId, corpusQuerySchema.parse(input));
}
