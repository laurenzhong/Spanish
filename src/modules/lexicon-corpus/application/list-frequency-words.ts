import type { FrequencyWordItem, LexiconCorpusRepository, PagedResult } from "../repositories";

export type FrequencyWordsQuery = Readonly<{ search?: string; page: number; pageSize: number }>;

export function listFrequencyWords(repository: LexiconCorpusRepository, query: FrequencyWordsQuery): Promise<PagedResult<FrequencyWordItem>> {
  return repository.listFrequencyWords(query);
}
