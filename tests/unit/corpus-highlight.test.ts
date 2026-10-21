import { describe, expect, it } from "vitest";
import { corpusHighlightRanges } from "@/src/modules/lexicon-corpus/domain/corpus-highlight";

describe("corpus source text highlights", () => {
  it("keeps accent, punctuation and repeated complete phrase offsets", () => {
    const text = "¡Por eso, café! Por eso vuelvo.";
    expect(corpusHighlightRanges(text, "por eso", "phrase").map((range) => text.slice(range.start, range.end))).toEqual(["Por eso", "Por eso"]);
    expect(corpusHighlightRanges(text, "cafe", "phrase").map((range) => text.slice(range.start, range.end))).toEqual(["café"]);
  });
  it("matches whole words, supports all-word highlights and never alters no-match text", () => {
    expect(corpusHighlightRanges("Una cafetería", "cafe", "all")).toEqual([]);
    const text = "Ana toma café y Ana vuelve.";
    expect(corpusHighlightRanges(text, "cafe ana", "all").map((range) => text.slice(range.start, range.end))).toEqual(["Ana", "café", "Ana"]);
    expect(corpusHighlightRanges(text, "", "phrase")).toEqual([]);
  });
});
