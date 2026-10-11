/**
 * How the shelf shows meanings, and where they come from.
 *
 * The meaning list is **single-sourced per word**: Language Reactor's hover
 * dictionary when it has the word, otherwise the reviewed Spanish–Chinese
 * glossary, otherwise nothing at all. Lists are never blended, because two
 * sources' orders cannot be merged into one order without inventing a rule for
 * it, and the UI must never present an order it cannot attribute.
 *
 * **The order is Language Reactor's, not a frequency ranking.** That endpoint
 * returns no frequency field, and its order is demonstrably not frequency
 * (LR answers `tl=en` with `banco` → bench | bank | stock, i.e. bank before
 * bench). The asset records this as `order: "language-reactor-hover-dictionary"`
 * and carries no rank on any entry; the UI says nothing about commonness. A real
 * rank would need LR's `base_dict_llmDict`, which needs the owner's session.
 *
 * The reviewed glossary's own order is likewise its file order, not a frequency
 * order — it is used as given.
 */

/** Never more than three translations are shown, and never padded to three. */
export const vocabularyMeaningLimit = 3;

/** The asset's own label for what its arrays' order means. */
export const languageReactorMeaningOrder = "language-reactor-hover-dictionary";

export type MeaningAsset = Readonly<{
  /** False when the asset is absent or does not have the shape this expects. */
  available: boolean;
  /** The asset's `order` label, surfaced for traceability (never rendered as a claim). */
  order: string | null;
  /** Word → up to three translations, in the asset's order. */
  meanings: Readonly<Record<string, readonly string[]>>;
}>;

export type DisplayMeaning = Readonly<{ meaning: string; usage: string }>;

export type MeaningSource = "language-reactor" | "reviewed-glossary" | "none";

export type DisplayMeanings = Readonly<{
  meanings: readonly DisplayMeaning[];
  source: MeaningSource;
}>;

const emptyAsset: MeaningAsset = { available: false, order: null, meanings: {} };

/**
 * Read a meaning asset tolerantly but without guessing: the documented shape is
 * `{ order, meanings: { word: [translation, ...] } }` (see
 * `scripts/build-lr-meaning-asset.ts`). Anything else is reported as
 * unavailable rather than interpreted, so a shape change shows up as a fallback
 * instead of as wrong text on the shelf.
 *
 * Within an accepted asset every entry is still cleaned: trimmed, non-strings
 * dropped, blanks and duplicates removed, and capped at
 * `vocabularyMeaningLimit` — **never padded**, never re-sorted.
 */
export function parseMeaningAsset(value: unknown): MeaningAsset {
  if (!value || typeof value !== "object") return emptyAsset;
  const document = value as { order?: unknown; meanings?: unknown };
  if (!document.meanings || typeof document.meanings !== "object" || Array.isArray(document.meanings)) return emptyAsset;

  const meanings: Record<string, readonly string[]> = {};
  for (const [word, translations] of Object.entries(document.meanings as Record<string, unknown>)) {
    if (!word.trim() || !Array.isArray(translations)) continue;
    const kept: string[] = [];
    for (const translation of translations) {
      if (typeof translation !== "string") continue;
      const candidate = translation.trim();
      if (!candidate || kept.includes(candidate)) continue;
      kept.push(candidate);
      if (kept.length === vocabularyMeaningLimit) break;
    }
    if (kept.length) meanings[word] = kept;
  }

  return {
    available: true,
    order: typeof document.order === "string" ? document.order : null,
    meanings,
  };
}

/**
 * The list a word shows: the tile takes its first entry, the hover layer takes
 * all of them (at most three). Both call this one function, so they can never
 * disagree about which meaning leads.
 *
 * - Language Reactor's translations win when the asset has the word.
 * - Otherwise the reviewed glossary's meanings are used, in the file's order —
 *   they are real reviewed content, so a word the scrape missed does not lose
 *   the meaning it already had.
 * - Otherwise the list is empty and the shelf shows 「释义待补充」. Nothing is
 *   invented, and an absent meaning is never rendered as one.
 */
export function displayMeanings(input: Readonly<{
  languageReactor: readonly string[] | undefined;
  glossary: readonly DisplayMeaning[] | undefined;
}>): DisplayMeanings {
  const fromLanguageReactor = (input.languageReactor ?? [])
    .map((meaning) => meaning.trim())
    .filter((meaning) => meaning.length > 0)
    .slice(0, vocabularyMeaningLimit);
  if (fromLanguageReactor.length) {
    return { meanings: fromLanguageReactor.map((meaning) => ({ meaning, usage: "" })), source: "language-reactor" };
  }

  const fromGlossary = (input.glossary ?? []).slice(0, vocabularyMeaningLimit);
  if (fromGlossary.length) return { meanings: fromGlossary, source: "reviewed-glossary" };

  return { meanings: [], source: "none" };
}
