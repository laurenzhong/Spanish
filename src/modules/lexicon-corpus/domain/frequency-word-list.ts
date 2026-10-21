import functionWordSource from "@/content/word-lists/es-function-words-v1.json";
import frequencySource from "@/content/word-lists/es-frequency-v1.json";

import { normalizeSpanishSurface } from "./spanish-token";

/**
 * The frequency shelf is no longer "whatever our own corpus happens to say most
 * often": that head is made of function words (`que`, `los`, `por`, `con`,
 * `una`, `las`, `para`, `del`) and of un-lemmatised surface forms
 * (`está`/`estoy`/`estuvo` in three rows). It is now driven by a committed,
 * ranked reference list of lemmas, with function words removed. This module owns
 * that decision; the repository only adds our corpus facts on top.
 *
 * Both inputs are content assets, not database state:
 * - `es-frequency-v1.json` is the ranked reference list (provenance alongside);
 * - `es-function-words-v1.json` is the deliberately conservative closed-class
 *   filter, with its inclusion criteria and every borderline decision written
 *   into the file itself.
 */

export type RankedContentWord = Readonly<{
  /** The reference list's surface form, spelled exactly as the list spells it. */
  word: string;
  /** Position in the reference list: 0 is the most frequent word. */
  rank: number;
}>;

type FunctionWordSource = Readonly<{ categories: Readonly<Record<string, readonly string[]>> }>;
type FrequencySource = Readonly<{ words: readonly string[] }>;

/**
 * Exact-surface, case-insensitive membership. Deliberately *not* accent-folded:
 * `té` (tea, rank 1136) folds onto the pronoun `te`, and `aún`/`aun`,
 * `sólo`/`solo` are separate entries in the reference list, so folding would
 * filter content words. Over-filtering hides vocabulary a learner wants.
 */
const functionWords: ReadonlySet<string> = new Set(
  Object.values((functionWordSource as FunctionWordSource).categories)
    .flat()
    .map((word) => word.toLocaleLowerCase("es")),
);

export function isFunctionWord(word: string): boolean {
  return functionWords.has(word.toLocaleLowerCase("es"));
}

let rankedCache: readonly RankedContentWord[] | null = null;

/**
 * The reference list with function words removed, still in reference-rank order.
 * Order is *never* recomputed from our corpus: that would push proper nouns and
 * corpus accidents to the top, which is the defect this shelf exists to fix.
 */
export function contentFrequencyWords(): readonly RankedContentWord[] {
  if (rankedCache) return rankedCache;
  const source = frequencySource as FrequencySource;
  const ranked: RankedContentWord[] = [];
  for (let rank = 0; rank < source.words.length; rank += 1) {
    const word = source.words[rank];
    if (word === undefined || isFunctionWord(word)) continue;
    ranked.push({ word, rank });
  }
  rankedCache = ranked;
  return ranked;
}

/**
 * Substring search over the shelf, on the same accent-folded form the corpus
 * index uses (`cafe` finds `café`). Order is preserved.
 */
export function searchContentFrequencyWords(search: string): readonly RankedContentWord[] {
  const ranked = contentFrequencyWords();
  const needle = normalizeSpanishSurface(search.trim());
  if (!needle) return ranked;
  return ranked.filter((entry) => normalizeSpanishSurface(entry.word).includes(needle));
}

/**
 * The shelf's capacity: the committed reference list's own length.
 *
 * It is a property of the list, not of the request, so nothing has to query for it.
 * Named once here because more than one caller needs the same number and they must
 * not drift: the page reads the shelf whole, the word lookup decides whether a word
 * is on the shelf at all, and the boot warm-up fills the same cache entry the page
 * will read.
 */
export function shelfCapacity(): number {
  return contentFrequencyWords().length;
}

/**
 * The one reference-list entry for a word, or null when the list does not carry it.
 *
 * Matched the way the rest of the shelf matches (`normalizeSpanishSurface`), so the
 * lookup answers about the same words the shelf renders and refuses the same ones.
 * The list's own surface form is returned, because that is what the tiles say.
 */
export function findContentFrequencyWord(word: string): RankedContentWord | null {
  const needle = normalizeSpanishSurface(word);
  if (!needle) return null;
  return contentFrequencyWords().find((entry) => normalizeSpanishSurface(entry.word) === needle) ?? null;
}
