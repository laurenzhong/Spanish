import { describe, expect, it } from "vitest";

import { normalizeLexeme } from "@/src/modules/lexicon-corpus/domain";

describe("lexeme normalization", () => {
  it("marks explicitly supplied lemmas as verified", () => {
    expect(normalizeLexeme({ surface: "comiendo", lemma: "comer", partOfSpeech: "verb" })).toEqual({ lemma: "comer", normalizedLemma: "comer", language: "es", partOfSpeech: "verb", lemmaStatus: "verified" });
  });

  it("keeps uncertain forms as pending instead of guessing a lemma", () => {
    expect(normalizeLexeme({ surface: "dámelo" })).toMatchObject({ lemma: "dámelo", normalizedLemma: "damelo", lemmaStatus: "pending" });
  });
});
