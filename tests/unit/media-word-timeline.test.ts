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
});
