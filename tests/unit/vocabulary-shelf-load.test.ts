// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadVocabularyShelf, VOCABULARY_EXAMPLES_TIMEOUT_MS } from "@/src/modules/lexicon-corpus/application/load-vocabulary-shelf";
import { contentFrequencyWords } from "@/src/modules/lexicon-corpus/domain/frequency-word-list";

describe("vocabulary shelf availability", () => {
  afterEach(() => vi.useRealTimers());

  it("renders all committed words in reference order without a database or invented corpus facts", async () => {
    const result = await loadVocabularyShelf({});
    expect(result.items.map((item) => item.word)).toEqual(contentFrequencyWords().map((item) => item.word));
    expect(result.total).toBe(7922);
    expect(result.examplesUnavailable).toBe(true);
    expect(result.items.every((item) => item.context === null && item.sourceTitle === null && !("occurrenceCount" in item))).toBe(true);
  });

  it("keeps successful corpus examples and never replaces a successful empty search", async () => {
    const item = { id: "word:casa", word: "casa", context: "Mi casa", sourceTitle: "Published podcast" };
    expect(await loadVocabularyShelf({ load: async () => ({ items: [item], total: 1 }) })).toMatchObject({ items: [item], examplesUnavailable: false });
    expect(await loadVocabularyShelf({ search: "zzzz", load: async () => ({ items: [], total: 0 }) })).toMatchObject({ items: [], total: 0, examplesUnavailable: false });
  });

  it("falls back on errors with the same accent-insensitive search and no fabricated examples", async () => {
    const result = await loadVocabularyShelf({ search: "cafe", load: async () => { throw new Error("DB unavailable"); } });
    expect(result.items.some((item) => item.word === "café")).toBe(true);
    expect(result.items.every((item) => item.context === null && item.sourceTitle === null)).toBe(true);
    expect(result.examplesUnavailable).toBe(true);
    const empty = await loadVocabularyShelf({ search: "zzzz", load: async () => { throw new Error("DB unavailable"); } });
    expect(empty).toMatchObject({ items: [], total: 0, examplesUnavailable: true });
  });

  it("bounds slow examples, releases the timer, and ignores late completion or rejection", async () => {
    vi.useFakeTimers();
    let rejectLoad!: (error: Error) => void;
    const pending = loadVocabularyShelf({ search: "casa", load: () => new Promise((_, reject) => { rejectLoad = reject; }) });
    await vi.advanceTimersByTimeAsync(VOCABULARY_EXAMPLES_TIMEOUT_MS);
    const result = await pending;
    expect(result.items.some((item) => item.word === "casa")).toBe(true);
    expect(result.examplesUnavailable).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    rejectLoad(new Error("Late DB failure"));
    await Promise.resolve();
    expect(result.examplesUnavailable).toBe(true);
    const fast = await loadVocabularyShelf({ load: async () => ({ items: [], total: 0 }) });
    expect(fast.examplesUnavailable).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not swap reference rows for corpus rows that arrive after the response", async () => {
    vi.useFakeTimers();
    let resolveLoad!: (result: { items: []; total: number }) => void;
    const pending = loadVocabularyShelf({ search: "casa", load: () => new Promise((resolve) => { resolveLoad = resolve; }) });
    await vi.advanceTimersByTimeAsync(VOCABULARY_EXAMPLES_TIMEOUT_MS);
    const result = await pending;
    resolveLoad({ items: [], total: 0 });
    await Promise.resolve();
    expect(result.items.some((item) => item.word === "casa")).toBe(true);
    expect(result.examplesUnavailable).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
