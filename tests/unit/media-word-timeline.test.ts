// @vitest-environment node

import { describe, expect, it } from "vitest";

import { wordTimingsForPlayback } from "@/src/modules/media/domain";

describe("media playback word timeline", () => {
  const base = {
    sourceText: "Hola mundo.",
    startMs: 0,
    endMs: 2_000,
  };

  it("fails closed when persisted offsets do not match lexical boundaries", () => {
    expect(wordTimingsForPlayback({
      ...base,
      words: [
        { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4 },
        { startMs: 900, endMs: 2_000, startOffset: 4, endOffset: 10 },
      ],
    })).toEqual([]);
  });

  it("fails closed when a provider word disagrees with sourceText", () => {
    expect(wordTimingsForPlayback({
      ...base,
      words: [
        { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4, text: "Hóla" },
        { startMs: 900, endMs: 2_000, startOffset: 5, endOffset: 10, text: "mundo" },
      ],
    })).toEqual([]);
  });

  it("keeps a timeline whose lexical text and offsets are exact", () => {
    const words = [
      { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4, text: "Hola" },
      { startMs: 900, endMs: 2_000, startOffset: 5, endOffset: 10, text: "mundo" },
    ] as const;
    expect(wordTimingsForPlayback({ ...base, words })).toEqual(words);
  });

  it("keeps legacy offset-only timings when offsets match the source text", () => {
    const words = [
      { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4 },
      { startMs: 900, endMs: 2_000, startOffset: 5, endOffset: 10 },
    ] as const;
    expect(wordTimingsForPlayback({ ...base, words })).toEqual(words);
  });

  it("treats a decimal comma as one spoken token", () => {
    const sourceText = "Un total de 1,6 kilómetros.";
    const words = [
      { startMs: 0, endMs: 100, startOffset: 0, endOffset: 2, text: "Un" },
      { startMs: 100, endMs: 200, startOffset: 3, endOffset: 8, text: "total" },
      { startMs: 200, endMs: 300, startOffset: 9, endOffset: 11, text: "de" },
      { startMs: 300, endMs: 500, startOffset: 12, endOffset: 15, text: "1,6" },
      { startMs: 500, endMs: 1_000, startOffset: 16, endOffset: 26, text: "kilómetros" },
    ] as const;
    expect(wordTimingsForPlayback({ sourceText, startMs: 0, endMs: 1_000, words })).toEqual(words);
  });
});
