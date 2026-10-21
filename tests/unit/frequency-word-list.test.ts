import { describe, expect, it } from "vitest";

import functionWordSource from "@/content/word-lists/es-function-words-v1.json";
import frequencySource from "@/content/word-lists/es-frequency-v1.json";
import { contentFrequencyWords, isFunctionWord, searchContentFrequencyWords } from "@/src/modules/lexicon-corpus/domain/frequency-word-list";
import { normalizeSpanishSurface } from "@/src/modules/lexicon-corpus/domain";

// The shelf is the committed reference list minus function words, in reference
// order. These tests run against the real 8000-word asset, not a fixture: the
// protection that matters most is that essential content verbs survive the
// filter, because LR's own top twenty is full of them (`ser`, `estar`, `haber`,
// `tener`, `ir`, `hacer`) and dropping them would hide vocabulary a learner
// needs.

type BorderlineDecision = Readonly<{ word: string; decision: "filter" | "keep"; reason: string }>;

const source = frequencySource as unknown as { readonly words: readonly string[] };
const metadata = functionWordSource as unknown as {
  readonly matching: { readonly mode: string; readonly note: readonly string[] };
  readonly authorship: { readonly source: string; readonly thirdParty: string };
  readonly criteria: { readonly include: readonly string[]; readonly exclude: readonly string[]; readonly principle: string };
  readonly borderline: readonly BorderlineDecision[];
  readonly neverFilter: readonly string[];
};

/** The old corpus head the user objected to: grammar glue with no learning value. */
const grammarHead = ["el", "que", "él", "de", "no", "a", "yo", "uno", "y", "en", "tú", "qué", "por", "ese", "este", "con", "sí", "pero", "para", "mi", "más", "si", "su", "del", "al", "como", "muy", "o", "porque", "cuando"];

const expectedFirstTwenty = ["ser", "estar", "haber", "tener", "ir", "hacer", "poder", "decir", "saber", "ver", "querer", "todo", "bien", "ya", "aquí", "creer", "dar", "pasar", "así", "solo"];

describe("frequency word list", () => {
  it("keeps every essential content verb advertised by the word list", () => {
    const ranked = contentFrequencyWords();
    const byWord = new Map(ranked.map((entry) => [entry.word, entry]));
    expect(metadata.neverFilter.length).toBeGreaterThanOrEqual(15);
    for (const verb of metadata.neverFilter) {
      expect(isFunctionWord(verb), `${verb} must never be treated as a function word`).toBe(false);
      // Every protected verb is high in the list, so it must survive into the shelf.
      expect(byWord.get(verb), `${verb} must survive the function-word filter`).toBeDefined();
      expect(byWord.get(verb)?.rank).toBeLessThan(100);
    }
  });

  it("removes the grammar head that used to top the shelf", () => {
    const words = new Set(contentFrequencyWords().map((entry) => entry.word));
    for (const word of grammarHead) {
      expect(isFunctionWord(word), `${word} should be filtered`).toBe(true);
      expect(words.has(word), `${word} must not reach the shelf`).toBe(false);
    }
  });

  it("honours every borderline decision documented in the word list itself", () => {
    expect(metadata.borderline.length).toBeGreaterThanOrEqual(20);
    for (const { word, decision, reason } of metadata.borderline) {
      expect(reason.length, `${word} must document why`).toBeGreaterThan(0);
      expect(isFunctionWord(word), `${word} is documented as ${decision}`).toBe(decision === "filter");
      const inShelf = contentFrequencyWords().some((entry) => entry.word === word);
      expect(inShelf, `${word} is documented as ${decision}`).toBe(decision === "keep");
    }
  });

  it("keeps the reference order, strictly ascending and without duplicates", () => {
    const ranked = contentFrequencyWords();
    expect(ranked.length).toBe(7922);
    expect(ranked.length).toBeLessThan(source.words.length);
    const seen = new Set<string>();
    let previousRank = -1;
    for (const entry of ranked) {
      expect(entry.rank).toBeGreaterThan(previousRank);
      previousRank = entry.rank;
      expect(seen.has(entry.word)).toBe(false);
      seen.add(entry.word);
    }
  });

  it("removes exactly the function words and nothing else", () => {
    const ranked = contentFrequencyWords();
    const expected = source.words.filter((word) => !isFunctionWord(word));
    expect(ranked.map((entry) => entry.word)).toEqual(expected);
    // 78 of the 8000 reference words are closed-class grammar.
    expect(source.words.length - ranked.length).toBe(78);
  });

  it("leaves no kept word shorter than the corpus count aggregate can measure", () => {
    // `computeCorpusFormCounts` aggregates forms of two characters or more, so a
    // kept one-character word would silently always read as zero occurrences.
    for (const entry of contentFrequencyWords()) expect(entry.word.length).toBeGreaterThanOrEqual(2);
  });

  it("does not over-filter content words that only collide after accent folding", () => {
    const words = new Set(contentFrequencyWords().map((entry) => entry.word));
    // `te` is a pronoun; `té` is tea. Folding accents would have deleted the tea.
    expect(isFunctionWord("te")).toBe(true);
    expect(words.has("té")).toBe(true);
    for (const word of ["aún", "aun", "sólo", "solo"]) {
      expect(words.has(word), `${word} must survive`).toBe(true);
    }
  });

  it("starts the shelf with vocabulary instead of grammar", () => {
    const firstTwenty = contentFrequencyWords().slice(0, 20).map((entry) => entry.word);
    expect(firstTwenty).toEqual(expectedFirstTwenty);
    for (const word of firstTwenty) expect(isFunctionWord(word)).toBe(false);
  });

  it("searches the shelf without leaving reference order and folds accents", () => {
    const all = contentFrequencyWords();
    expect(searchContentFrequencyWords("")).toEqual(all);
    expect(searchContentFrequencyWords("   ")).toEqual(all);

    const matches = searchContentFrequencyWords("aqui");
    expect(matches.map((entry) => entry.word)).toContain("aquí");
    expect(matches.length).toBeLessThan(all.length);
    expect(matches.length).toBeGreaterThan(0);
    for (const entry of matches) expect(normalizeSpanishSurface(entry.word)).toContain("aqui");
    const ranks = matches.map((entry) => entry.rank);
    expect([...ranks].sort((left, right) => left - right)).toEqual(ranks);

    expect(searchContentFrequencyWords("zzzzzz")).toEqual([]);
  });

  it("documents its own criteria and provenance in the asset", () => {
    expect(metadata.matching.mode).toBe("exact-surface-lowercase");
    expect(metadata.matching.note.length).toBeGreaterThan(0);
    expect(metadata.authorship.source).toBe("self-authored");
    expect(metadata.authorship.thirdParty).toBe("none");
    expect(metadata.criteria.include.length).toBeGreaterThan(0);
    expect(metadata.criteria.exclude.length).toBeGreaterThan(0);
    expect(metadata.criteria.principle.length).toBeGreaterThan(0);
  });
});
