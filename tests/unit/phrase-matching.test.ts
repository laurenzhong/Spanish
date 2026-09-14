import { describe, expect, it } from "vitest";

import { findPhraseMatches, normalizePhrase } from "@/src/modules/lexicon-corpus/domain";

describe("phrase matching", () => {
  it("matches accents and punctuation and preserves overlapping occurrences", () => {
    expect(findPhraseMatches("¿Qué tal? Que tal, todo bien.", "qué tal")).toEqual([
      { startToken: 0, endToken: 1, surface: "Qué tal", normalized: "que tal" },
      { startToken: 2, endToken: 3, surface: "Que tal", normalized: "que tal" },
    ]);
  });

  it("normalizes a phrase using token boundaries", () => {
    expect(normalizePhrase("  ¿Me  puede ayudar? ")).toBe("me puede ayudar");
  });
});
