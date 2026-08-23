import { describe, expect, it } from "vitest";

import { compareTranscripts } from "@/src/modules/providers/stt";

describe("compareTranscripts", () => {
  it("matches words regardless of accents, case, or punctuation", () => {
    const result = compareTranscripts(
      "La información es útil.",
      "la informacion es util",
    );

    expect(result.matchRatio).toBe(1);
    expect(result.differences).toEqual([]);
  });

  it("reports a substituted token", () => {
    const result = compareTranscripts("El trabajo es importante.", "El Trapajo es importante.");

    expect(result.differences).toEqual([
      expect.objectContaining({
        kind: "substitution",
        classification: "token-mismatch",
        expectedText: "trabajo",
        actualText: "Trapajo",
        expectedTokenStart: 1,
        actualTokenStart: 1,
      }),
    ]);
  });

  it("reports omitted and added tokens separately", () => {
    const result = compareTranscripts(
      "El trabajo es muy importante.",
      "El trabajo es importante y útil.",
    );

    expect(result.summary.omissionCount).toBe(1);
    expect(result.summary.additionCount).toBe(1);
    expect(result.differences).toEqual([
      expect.objectContaining({ kind: "omission", expectedText: "muy" }),
      expect.objectContaining({ kind: "addition", actualText: "y útil" }),
    ]);
  });

  it("flags a likely English recognition when an English token replaces Spanish text", () => {
    const result = compareTranscripts(
      "La inteligencia artificial procesa datos.",
      "La inteligencia artificial procesa data.",
    );

    expect(result.summary.possibleLanguageMismatchCount).toBe(1);
    expect(result.differences[0]).toEqual(expect.objectContaining({
      classification: "possible-language-mismatch",
      expectedText: "datos",
      actualText: "data",
    }));
  });

  it("returns a perfect ratio for two empty transcripts", () => {
    expect(compareTranscripts("", "")).toMatchObject({
      expectedTokenCount: 0,
      actualTokenCount: 0,
      matchedTokenCount: 0,
      matchRatio: 1,
      differences: [],
    });
  });
});
