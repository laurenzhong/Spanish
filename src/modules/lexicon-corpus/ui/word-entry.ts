import { findCommonGlossaryEntry, normalizeGlossarySurface, type CommonGlossaryEntry } from "@/src/modules/reading/domain/common-glossary";

import type { FrequencyWordItem } from "../repositories";
import type { VocabularyShelfGlossary } from "./vocabulary-shelf";
import type { VocabularyShelfItem } from "./vocabulary-shelf-list";
import { displayMeanings, type DisplayMeaning, type DisplayMeanings } from "./vocabulary-meanings";

/**
 * One shelf row, and the reviewed glossary entry behind it, built in one place.
 *
 * The shelf page and the word lookup both need this: the page for every word it
 * renders, the lookup for the one word a reader typed. Sharing it is what keeps the
 * two from answering differently about the same word — the meanings a lookup shows
 * for `casa` are the meanings the tile for `casa` would have shown, because both
 * came through this function and through `displayMeanings` behind it.
 */
export type WordEntry = Readonly<{
  /** The browser-local mark identity: the accent-folded headword. */
  markKey: string;
  /** The reference list's own surface form, which is what the tile says. */
  word: string;
  meanings: DisplayMeanings;
  /** The reviewed entry, or null when the reviewed file does not carry the word. */
  reviewed: CommonGlossaryEntry | null;
  /**
   * The reviewed meanings with their usage notes, independent of which source is
   * *displayed*. The panel shows Language Reactor's translations and, beside them,
   * the reviewed usage notes — so this must not be run through `displayMeanings`,
   * which drops the notes as soon as LR has the word.
   */
  reviewedMeanings: readonly DisplayMeaning[];
  /** The reviewed usage notes, in the reviewed order. */
  usageNotes: readonly string[];
  cefr: string | null;
  partOfSpeech: string | null;
  collocations: readonly string[];
  examples: readonly string[];
  forms: readonly string[];
}>;

/**
 * The shelf row for one word, plus its reviewed glossary entry.
 *
 * `markKey` stays the accent-folded headword — the identity the study shelf's
 * browser-local marks were stored under — so a mark made on the study shelf still
 * lands on this word.
 *
 * The tile's meaning and the panel's list both come from `displayMeanings`, so they
 * can never disagree: Language Reactor's translations when the asset has the word,
 * otherwise the reviewed entry's own meanings, otherwise nothing (「释义待补充」).
 * The order is always the source's own — LR returns no frequency field and the
 * glossary file has none — so no position is presented as commonness.
 */
export function wordEntry(
  item: Pick<FrequencyWordItem, "word">,
  /** Language Reactor's translations for this word, when the asset has it. */
  assetMeanings: readonly string[] | undefined,
): WordEntry {
  const reviewed = findCommonGlossaryEntry(item.word);
  const markKey = reviewed ? normalizeGlossarySurface(reviewed.headword) : normalizeGlossarySurface(item.word);
  const reviewedMeanings = reviewed?.meanings.map((meaning) => ({ meaning: meaning.meaning, usage: meaning.usage }));
  return {
    markKey,
    word: item.word,
    meanings: displayMeanings({ languageReactor: assetMeanings, glossary: reviewedMeanings }),
    reviewed,
    reviewedMeanings: reviewedMeanings ?? [],
    usageNotes: reviewed ? reviewed.meanings.map((meaning) => meaning.usage).filter((usage) => usage.trim().length > 0) : [],
    cefr: reviewed?.cefr ?? null,
    partOfSpeech: reviewed?.partOfSpeech ?? null,
    collocations: reviewed?.collocations ?? [],
    examples: reviewed?.examples ?? [],
    forms: reviewed?.forms ?? [],
  };
}

/** The panel's own shape for a reviewed entry, built from a {@link WordEntry}. */
export function shelfGlossary(row: WordEntry): VocabularyShelfGlossary | null {
  if (!row.reviewed) return null;
  return {
    cefr: row.cefr ?? "",
    partOfSpeech: row.partOfSpeech ?? "",
    // The reviewed meanings, not the displayed ones: the panel pairs Language
    // Reactor's translations with the reviewed usage notes, and the displayed list
    // is LR's exactly when LR has the word.
    meanings: row.reviewedMeanings,
    collocations: row.collocations,
    examples: row.examples,
    forms: row.forms,
    // Tatoeba's examples are not part of the page's payload: they are fetched when a word is
    // opened. A word looked up by name arrives with its own, so this stays empty here.
    tatoeba: [],
  };
}

/**
 * The shelf row, and the glossary entry the frame needs when the word is opened.
 *
 * The frame's `glossary` map is keyed by mark key and filled on the way past, so a
 * word whose tile is on the page carries the reviewed detail the panel shows. The
 * map is only written when the page has not already got that word: accent-folded
 * keys repeat (`solo`/`sólo`), and the first entry is the one the tile rendered.
 *
 * Tatoeba's examples come in here rather than as a third map on the frame: they belong
 * to the same "what this word has" record the panel reads, and a word with examples but
 * no reviewed entry still has to reach the panel.
 */
export function shelfItem(
  item: Pick<FrequencyWordItem, "id" | "word" | "context" | "sourceTitle">,
  glossary: Record<string, VocabularyShelfGlossary>,
  assetMeanings: Readonly<Record<string, readonly string[]>>,
): VocabularyShelfItem {
  const row = wordEntry(item, assetMeanings[item.word]);
  const entry = shelfGlossary(row);
  if (entry && !glossary[row.markKey]) glossary[row.markKey] = entry;
  return {
    id: item.id,
    markKey: row.markKey,
    text: row.word,
    context: item.context,
    source: item.sourceTitle,
    meaning: row.meanings.meanings[0]?.meaning ?? null,
  };
}
