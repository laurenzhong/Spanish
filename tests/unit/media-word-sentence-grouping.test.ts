// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  groupProviderWordsIntoSentences,
  hasExactWordLexemes,
  MediaWordTimelineError,
  validWordTimings,
} from "@/src/modules/media/domain";

function assertExactWords(sentences: readonly Readonly<{
  startMs: number;
  endMs: number;
  sourceText: string;
  words: readonly Readonly<{ startMs: number; endMs: number; startOffset: number; endOffset: number; text?: string }>[];
}>[]) {
  for (const sentence of sentences) {
    expect(validWordTimings(sentence)).toHaveLength(sentence.words.length);
    expect(hasExactWordLexemes(sentence)).toBe(true);
  }
}

describe("groupProviderWordsIntoSentences", () => {
  it("builds one sentence with exact offsets and provider times from word units", () => {
    const sentences = groupProviderWordsIntoSentences([
      { startMs: 0, endMs: 400, text: "Hola" },
      { startMs: 400, endMs: 500, text: "," },
      { startMs: 600, endMs: 700, text: "¿" },
      { startMs: 700, endMs: 1_100, text: "qué" },
      { startMs: 1_100, endMs: 1_500, text: "tal" },
      { startMs: 1_500, endMs: 1_600, text: "?" },
    ], { durationMs: 5_000 });

    expect(sentences).toEqual([{
      startMs: 0,
      endMs: 1_600,
      sourceText: "Hola, ¿qué tal?",
      words: [
        { startMs: 0, endMs: 400, startOffset: 0, endOffset: 4, text: "Hola" },
        { startMs: 700, endMs: 1_100, startOffset: 7, endOffset: 10, text: "qué" },
        { startMs: 1_100, endMs: 1_500, startOffset: 11, endOffset: 14, text: "tal" },
      ],
    }]);
    assertExactWords(sentences);
  });

  it("splits on sentence-final punctuation and keeps trailing closing quotes attached", () => {
    const sentences = groupProviderWordsIntoSentences([
      { startMs: 0, endMs: 300, text: "Buenos" },
      { startMs: 300, endMs: 700, text: "días." },
      { startMs: 700, endMs: 800, text: "»" },
      { startMs: 900, endMs: 1_200, text: "¿Qué" },
      { startMs: 1_200, endMs: 1_400, text: "tal?" },
    ], { durationMs: 3_000 });

    expect(sentences).toEqual([
      {
        startMs: 0,
        endMs: 800,
        sourceText: "Buenos días.»",
        words: [
          { startMs: 0, endMs: 300, startOffset: 0, endOffset: 6, text: "Buenos" },
          { startMs: 300, endMs: 700, startOffset: 7, endOffset: 11, text: "días" },
        ],
      },
      {
        startMs: 900,
        endMs: 1_400,
        sourceText: "¿Qué tal?",
        words: [
          { startMs: 900, endMs: 1_200, startOffset: 1, endOffset: 4, text: "Qué" },
          { startMs: 1_200, endMs: 1_400, startOffset: 5, endOffset: 8, text: "tal" },
        ],
      },
    ]);
    assertExactWords(sentences);
  });

  it("splits when the silent gap between provider words exceeds one second", () => {
    const sentences = groupProviderWordsIntoSentences([
      { startMs: 0, endMs: 200, text: "Uno" },
      { startMs: 200, endMs: 400, text: "dos" },
      { startMs: 1_500, endMs: 1_700, text: "tres" },
    ], { durationMs: 2_000 });

    expect(sentences.map((sentence) => ({ sourceText: sentence.sourceText, startMs: sentence.startMs, endMs: sentence.endMs }))).toEqual([
      { sourceText: "Uno dos", startMs: 0, endMs: 400 },
      { sourceText: "tres", startMs: 1_500, endMs: 1_700 },
    ]);
    expect(sentences.map((sentence) => sentence.words.length)).toEqual([2, 1]);
    assertExactWords(sentences);
  });

  it("bounds sentence text length so long authoring cues cannot grow past the schema limit", () => {
    const units = Array.from({ length: 20 }, (_, index) => ({
      startMs: index * 1_000,
      endMs: index * 1_000 + 500,
      text: `a${String(index).padStart(19, "0")}`,
    }));
    const sentences = groupProviderWordsIntoSentences(units, { durationMs: 20_000 });

    expect(sentences.map((sentence) => sentence.words.length)).toEqual([12, 8]);
    expect(sentences.map((sentence) => sentence.sourceText.length)).toEqual([251, 167]);
    assertExactWords(sentences);
  });

  it("returns no sentences for an empty provider response", () => {
    expect(groupProviderWordsIntoSentences([], { durationMs: 1_000 })).toEqual([]);
  });

  it("fails closed when a provider unit contains more than one lexical token", () => {
    expect(() => groupProviderWordsIntoSentences([
      { startMs: 0, endMs: 900, text: "Buenos días." },
    ], { durationMs: 1_000 })).toThrow(MediaWordTimelineError);
    expect(() => groupProviderWordsIntoSentences([
      { startMs: 0, endMs: 900, text: "Buenos días." },
    ], { durationMs: 1_000 })).toThrow(/word-level/u);
  });

  it("fails closed for non-integer, inverted, or overlapping provider timings", () => {
    expect(() => groupProviderWordsIntoSentences([
      { startMs: 0, endMs: 500.5, text: "Hola" },
    ], { durationMs: 1_000 })).toThrow(MediaWordTimelineError);
    expect(() => groupProviderWordsIntoSentences([
      { startMs: 500, endMs: 500, text: "Hola" },
    ], { durationMs: 1_000 })).toThrow(MediaWordTimelineError);
    expect(() => groupProviderWordsIntoSentences([
      { startMs: 0, endMs: 600, text: "Hola" },
      { startMs: 500, endMs: 900, text: "mundo" },
    ], { durationMs: 1_000 })).toThrow(MediaWordTimelineError);
    expect(() => groupProviderWordsIntoSentences([
      { startMs: 0, endMs: 500, text: "   " },
    ], { durationMs: 1_000 })).toThrow(MediaWordTimelineError);
  });

  it("fails closed when provider timings end after the candidate media duration", () => {
    expect(() => groupProviderWordsIntoSentences([
      { startMs: 0, endMs: 500, text: "Hola" },
      { startMs: 500, endMs: 6_000, text: "mundo" },
    ], { durationMs: 5_000 })).toThrow(/duration/u);
  });
});
