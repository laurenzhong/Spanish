import { describe, expect, it } from "vitest";

import { normalizeSpanishSurface, tokenizeSpanish } from "@/src/modules/lexicon-corpus/domain";

describe("Spanish tokenization", () => {
  it("keeps accented words and apostrophe forms while dropping punctuation", () => {
    expect(tokenizeSpanish("¡Qué tal! Dámelo, por favor.")).toEqual([
      { surface: "Qué", normalized: "que", start: 1, end: 4 },
      { surface: "tal", normalized: "tal", start: 5, end: 8 },
      { surface: "Dámelo", normalized: "damelo", start: 10, end: 16 },
      { surface: "por", normalized: "por", start: 18, end: 21 },
      { surface: "favor", normalized: "favor", start: 22, end: 27 },
    ]);
  });

  it("normalizes case and accents without changing the original surface", () => {
    expect(normalizeSpanishSurface("ÁRBOLES")).toBe("arboles");
  });
});
