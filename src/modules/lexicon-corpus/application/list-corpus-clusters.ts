import type { LexiconCorpusRepository } from "../repositories/lexicon-corpus-repository";
import { corpusBrowseQuerySchema, type CorpusBrowseQueryInput } from "../schemas/lexicon";

export async function listCorpusClusters(
  repository: LexiconCorpusRepository,
  userId: string | undefined,
  input: CorpusBrowseQueryInput,
) {
  return repository.listCorpusClusters(userId, corpusBrowseQuerySchema.parse(input));
}
