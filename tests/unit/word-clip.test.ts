// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  DEFAULT_POST_ROLL_MS,
  DEFAULT_PRE_ROLL_MS,
  MIN_WORD_WINDOW_MS,
  findWordClip,
} from "@/src/modules/lexicon-corpus/domain/word-clip";

// Every fixture below uses offsets that really match the lexical boundaries of
// its sourceText, because wordTimingsForPlayback() rejects fabricated ones.
const escuadronSegment = {
  sourceText: "El escuadrón llegó.",
  startMs: 10_000,
  endMs: 12_000,
  words: [
    { startMs: 10_000, endMs: 10_300, startOffset: 0, endOffset: 2, text: "El" },
    { startMs: 10_300, endMs: 11_000, startOffset: 3, endOffset: 12, text: "escuadrón" },
    { startMs: 11_000, endMs: 11_600, startOffset: 13, endOffset: 18, text: "llegó" },
  ],
};

const holaMundoSegment = {
  sourceText: "Hola mundo",
  startMs: 1_000,
  endMs: 2_000,
  words: [
    { startMs: 1_000, endMs: 1_400, startOffset: 0, endOffset: 4, text: "Hola" },
    { startMs: 1_400, endMs: 1_900, startOffset: 5, endOffset: 10, text: "mundo" },
  ],
};

describe("findWordClip", () => {
  it("publishes the documented roll and minimum-window defaults", () => {
    expect(DEFAULT_PRE_ROLL_MS).toBe(120);
    expect(DEFAULT_POST_ROLL_MS).toBe(250);
    expect(MIN_WORD_WINDOW_MS).toBe(60);
  });

  it("locates a word through accent-folded, case-folded token equality", () => {
    expect(findWordClip(escuadronSegment, "escuadron")).toEqual({ startMs: 10_180, stopAtMs: 11_250 });
    expect(findWordClip(escuadronSegment, "ESCUADRÓN")).toEqual({ startMs: 10_180, stopAtMs: 11_250 });
  });

  it("matches an unaccented token when the shelf word carries an accent", () => {
    const segment = {
      sourceText: "Un escuadron llego.",
      startMs: 5_000,
      endMs: 6_500,
      words: [
        { startMs: 5_000, endMs: 5_300, startOffset: 0, endOffset: 2, text: "Un" },
        { startMs: 5_300, endMs: 5_900, startOffset: 3, endOffset: 12, text: "escuadron" },
        { startMs: 5_900, endMs: 6_400, startOffset: 13, endOffset: 18, text: "llego" },
      ],
    };
    expect(findWordClip(segment, "escuadrón")).toEqual({ startMs: 5_180, stopAtMs: 6_150 });
  });

  it("reads legacy offset-only timings through the source slice", () => {
    const segment = {
      sourceText: "El escuadrón llegó.",
      startMs: 10_000,
      endMs: 12_000,
      words: [
        { startMs: 10_000, endMs: 10_300, startOffset: 0, endOffset: 2 },
        { startMs: 10_300, endMs: 11_000, startOffset: 3, endOffset: 12 },
        { startMs: 11_000, endMs: 11_600, startOffset: 13, endOffset: 18 },
      ],
    };
    expect(findWordClip(segment, "escuadron")).toEqual({ startMs: 10_180, stopAtMs: 11_250 });
  });

  it("never accepts a substring as a hit", () => {
    expect(findWordClip(escuadronSegment, "escuadro")).toBeNull();
    expect(findWordClip({
      sourceText: "solo",
      startMs: 0,
      endMs: 1_000,
      words: [{ startMs: 0, endMs: 900, startOffset: 0, endOffset: 4, text: "solo" }],
    }, "sol")).toBeNull();
  });

  it("fails closed when the word is absent or empty", () => {
    expect(findWordClip(escuadronSegment, "caballo")).toBeNull();
    expect(findWordClip(escuadronSegment, "")).toBeNull();
  });

  it("takes the earliest window when repeated hits describe one event", () => {
    // Closed intervals touching at 500 ms are one continuous pronunciation of
    // "sol", and a validated provider timeline cannot overlap more deeply than
    // that. Guessing between them would be worse than refusing.
    const segment = {
      sourceText: "sol sol",
      startMs: 0,
      endMs: 2_000,
      words: [
        { startMs: 0, endMs: 500, startOffset: 0, endOffset: 3, text: "sol" },
        { startMs: 500, endMs: 1_000, startOffset: 4, endOffset: 7, text: "sol" },
      ],
    };
    expect(findWordClip(segment, "sol")).toEqual({ startMs: 0, stopAtMs: 750 });
  });

  it("fails closed when the same surface occurs at two different times", () => {
    const segment = {
      sourceText: "sol y sol",
      startMs: 0,
      endMs: 2_000,
      words: [
        { startMs: 0, endMs: 400, startOffset: 0, endOffset: 3, text: "sol" },
        { startMs: 400, endMs: 500, startOffset: 4, endOffset: 5, text: "y" },
        { startMs: 600, endMs: 1_000, startOffset: 6, endOffset: 9, text: "sol" },
      ],
    };
    expect(findWordClip(segment, "sol")).toBeNull();
  });

  it("fails closed when overlapping hits do not all share one window", () => {
    const segment = {
      sourceText: "sol sol sol",
      startMs: 0,
      endMs: 2_000,
      words: [
        { startMs: 0, endMs: 300, startOffset: 0, endOffset: 3, text: "sol" },
        { startMs: 300, endMs: 600, startOffset: 4, endOffset: 7, text: "sol" },
        { startMs: 600, endMs: 900, startOffset: 8, endOffset: 11, text: "sol" },
      ],
    };
    expect(findWordClip(segment, "sol")).toBeNull();
  });

  it("fails closed without a verified provider timeline", () => {
    const base = { sourceText: "Hola", startMs: 0, endMs: 1_000 };
    expect(findWordClip(base, "Hola")).toBeNull();
    expect(findWordClip({ ...base, words: [] }, "Hola")).toBeNull();
    expect(findWordClip({ ...base, words: null }, "Hola")).toBeNull();
  });

  it("fails closed when persisted offsets leave the lexical boundaries", () => {
    const segment = {
      sourceText: "Hola mundo",
      startMs: 0,
      endMs: 2_000,
      words: [
        { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4, text: "Hola" },
        { startMs: 900, endMs: 1_800, startOffset: 5, endOffset: 11, text: "mundo" },
      ],
    };
    expect(findWordClip(segment, "Hola")).toBeNull();
  });

  it("fails closed when the provider word text disagrees with sourceText", () => {
    const segment = {
      sourceText: "Hola mundo",
      startMs: 0,
      endMs: 2_000,
      words: [
        { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4, text: "Hóla" },
        { startMs: 900, endMs: 1_800, startOffset: 5, endOffset: 10, text: "mundo" },
      ],
    };
    expect(findWordClip(segment, "Hola")).toBeNull();
  });

  it("fails closed when the timeline is not monotonic", () => {
    const segment = {
      sourceText: "Hola mundo",
      startMs: 0,
      endMs: 2_000,
      words: [
        { startMs: 0, endMs: 900, startOffset: 0, endOffset: 4, text: "Hola" },
        { startMs: 800, endMs: 1_800, startOffset: 5, endOffset: 10, text: "mundo" },
      ],
    };
    expect(findWordClip(segment, "mundo")).toBeNull();
  });

  it("clamps the pre-roll to segment.startMs", () => {
    expect(findWordClip(holaMundoSegment, "Hola")).toEqual({ startMs: 1_000, stopAtMs: 1_650 });
  });

  it("clamps the post-roll to segment.endMs", () => {
    expect(findWordClip(holaMundoSegment, "mundo")).toEqual({ startMs: 1_280, stopAtMs: 2_000 });
  });

  it("honours explicit roll options", () => {
    expect(findWordClip(holaMundoSegment, "mundo", { preRollMs: 500, postRollMs: 500 }))
      .toEqual({ startMs: 1_000, stopAtMs: 2_000 });
  });

  it("fails closed for malformed options instead of shifting the window", () => {
    expect(findWordClip(holaMundoSegment, "mundo", { preRollMs: -1 })).toBeNull();
    expect(findWordClip(holaMundoSegment, "mundo", { postRollMs: Number.NaN })).toBeNull();
    expect(findWordClip(holaMundoSegment, "mundo", { minWordWindowMs: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("degrades to the whole segment when the provider window is too narrow", () => {
    const segment = {
      sourceText: "No",
      startMs: 500,
      endMs: 3_000,
      words: [{ startMs: 900, endMs: 940, startOffset: 0, endOffset: 2, text: "No" }],
    };
    expect(findWordClip(segment, "no")).toEqual({ startMs: 500, stopAtMs: 3_000 });
  });

  it("keeps a provider window that reaches the configured minimum", () => {
    const segment = {
      sourceText: "No",
      startMs: 500,
      endMs: 3_000,
      words: [{ startMs: 900, endMs: 940, startOffset: 0, endOffset: 2, text: "No" }],
    };
    expect(findWordClip(segment, "no", { minWordWindowMs: 40 })).toEqual({ startMs: 780, stopAtMs: 1_190 });
  });

  it("keeps a provider window exactly at the default minimum", () => {
    const segment = {
      sourceText: "Sí",
      startMs: 0,
      endMs: 1_000,
      words: [{ startMs: 0, endMs: 60, startOffset: 0, endOffset: 2, text: "Sí" }],
    };
    expect(findWordClip(segment, "si")).toEqual({ startMs: 0, stopAtMs: 310 });
  });
});
