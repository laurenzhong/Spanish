import { searchContentFrequencyWords } from "../domain/frequency-word-list";
import { normalizeSpanishSurface } from "../domain/spanish-token";
import type { FrequencyWordItem } from "../repositories/lexicon-corpus-repository";

/** The display needs optional examples, never fabricated occurrence counts. */
export type VocabularyShelfRow = Pick<FrequencyWordItem, "id" | "word" | "context" | "sourceTitle">;
type ShelfRows = Readonly<{ items: readonly VocabularyShelfRow[]; total: number }>;
export const VOCABULARY_EXAMPLES_TIMEOUT_MS = 1500;

/** Corpus enrichment cannot prevent access to the committed reference vocabulary. */
export async function loadVocabularyShelf(options: Readonly<{
  search?: string;
  load?: () => Promise<ShelfRows>;
}>): Promise<ShelfRows & Readonly<{ examplesUnavailable: boolean }>> {
  if (options.load) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const loaded = await Promise.race([
        Promise.resolve().then(options.load),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("VOCABULARY_EXAMPLES_TIMEOUT")), VOCABULARY_EXAMPLES_TIMEOUT_MS);
        }),
      ]);
      return { ...loaded, examplesUnavailable: false };
    } catch {
      // A late query still settles its existing promise/cache, but cannot change this response.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  const items = searchContentFrequencyWords(options.search ?? "").map(({ word }) => ({
    id: `word:${normalizeSpanishSurface(word)}`, word, context: null, sourceTitle: null,
  }));
  return { items, total: items.length, examplesUnavailable: true };
}
