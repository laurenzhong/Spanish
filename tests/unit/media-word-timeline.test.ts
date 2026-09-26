import { describe, expect, it } from "vitest";

import {
  activeWordAt,
  mediaWordMatches,
  validWordTimings,
  wordTimingsForPlayback,
} from "@/src/modules/media/domain/word-timeline";

describe("media word timelines", () => {
  it("recognizes numeric and clock-like tokens using the same boundaries as playback", () => {
    const matches = mediaWordMatches("A2 a las 2:33, el día 24.");
    expect(matches.map((match) => match[0])).toEqual(["A2", "a", "las", "2:33", "el", "día", "24"]);
  });

  it("accepts an exact provider timeline and selects the active word", () => {
    const sourceText = "Hola mundo";
    const words = [
      { startMs: 0, endMs: 500, startOffset: 0, endOffset: 4, text: "Hola" },
      { startMs: 500, endMs: 1_000, startOffset: 5, endOffset: 10, text: "mundo" },
    ] as const;
    const segment = { sourceText, startMs: 0, endMs: 1_000, words };
    expect(validWordTimings(segment)).toEqual(words);
    expect(wordTimingsForPlayback(segment)).toEqual(words);
    expect(activeWordAt(words, 650)).toMatchObject({ text: "mundo" });
  });

  it("fails closed when a provider token does not match the source text", () => {
    const segment = {
      sourceText: "Hola mundo",
      startMs: 0,
      endMs: 1_000,
      words: [
        { startMs: 0, endMs: 500, startOffset: 0, endOffset: 4, text: "Hola" },
        { startMs: 500, endMs: 1_000, startOffset: 5, endOffset: 10, text: "mundo!" },
      ],
    } as const;
    expect(validWordTimings(segment)).toEqual([]);
    expect(wordTimingsForPlayback(segment)).toEqual([]);
  });
});
