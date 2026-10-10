import { describe, expect, it } from "vitest";

import {
  DEFAULT_LEXICON_INDEXING_MODE,
  LEXICON_INDEXING_MODE_ENV_KEY,
  isLexiconIndexingMode,
  lexiconIndexingExtracts,
  lexiconIndexingIndexes,
  lexiconIndexingReviews,
  normalizeLexiconIndexingMode,
  resolveLexiconIndexingMode,
} from "@/src/modules/lexicon-corpus/application/lexicon-indexing-mode";

/**
 * LEX-INDEX-001 slice 6: the feature switch.
 *
 * ADR-0011 §7 makes indexing off by default and fail-closed. The tests below are
 * the whole contract: a missing value, an empty value and *every* value that is
 * not literally one of the documented modes must resolve to `disabled`, and
 * `review-only` must never be able to index.
 */

const KEY = LEXICON_INDEXING_MODE_ENV_KEY;

describe("LEXICON_INDEXING_MODE is off unless explicitly enabled (LEX-INDEX-001 slice 6)", () => {
  it("names the configuration key exactly and defaults to disabled", () => {
    expect(KEY).toBe("LEXICON_INDEXING_MODE");
    expect(DEFAULT_LEXICON_INDEXING_MODE).toBe("disabled");
    expect(resolveLexiconIndexingMode({})).toBe("disabled");
  });

  it("treats a missing or blank switch as disabled", () => {
    for (const environment of [
      {},
      { [KEY]: undefined },
      { [KEY]: "" },
      { [KEY]: "   " },
      { [KEY]: "\t\n" },
    ]) {
      expect(resolveLexiconIndexingMode(environment)).toBe("disabled");
    }
  });

  it("treats every invalid value as disabled (fail-closed)", () => {
    for (const value of [
      "true",
      "false",
      "yes",
      "on",
      "off",
      "1",
      "0",
      "enabled",
      "enable",
      "full",
      "review_only",
      "reviewonly",
      "review",
      "indexing",
      "indexed",
      "disabled ",
      " disabledx",
      "review-onl",
      "indexx",
      "ｄｉｓａｂｌｅｄ",
    ]) {
      expect(resolveLexiconIndexingMode({ [KEY]: value })).toBe("disabled");
    }
  });

  it("accepts only the documented modes, tolerating case and surrounding space", () => {
    expect(resolveLexiconIndexingMode({ [KEY]: "disabled" })).toBe("disabled");
    expect(resolveLexiconIndexingMode({ [KEY]: "review-only" })).toBe("review-only");
    expect(resolveLexiconIndexingMode({ [KEY]: " REVIEW-ONLY " })).toBe("review-only");
    expect(resolveLexiconIndexingMode({ [KEY]: "Review-Only" })).toBe("review-only");
    expect(resolveLexiconIndexingMode({ [KEY]: "index" })).toBe("index");
    expect(resolveLexiconIndexingMode({ [KEY]: "INDEX" })).toBe("index");
  });

  it("is not unlocked by a provider credential", () => {
    // A live key in the environment must not turn indexing on by accident.
    expect(resolveLexiconIndexingMode({ MINIMAX_API_KEY: "sk-not-a-real-key" })).toBe("disabled");
    // And a missing credential must not turn an explicitly configured mode off:
    // the switch decides, the runtime decides whether it can serve the mode.
    expect(resolveLexiconIndexingMode({ [KEY]: "review-only" })).toBe("review-only");
  });

  it("normalises unknown runtime values, not just environment strings", () => {
    for (const value of [undefined, null, 42, true, false, {}, [], Symbol("index")]) {
      expect(normalizeLexiconIndexingMode(value)).toBe("disabled");
    }
    expect(normalizeLexiconIndexingMode("review-only")).toBe("review-only");
    expect(normalizeLexiconIndexingMode(" index ")).toBe("index");
    expect(isLexiconIndexingMode("index")).toBe(true);
    expect(isLexiconIndexingMode("Index")).toBe(false);
    expect(isLexiconIndexingMode(3)).toBe(false);
  });

  it("reads process.env when no environment record is passed", () => {
    const original = process.env[KEY];
    try {
      delete process.env[KEY];
      expect(resolveLexiconIndexingMode()).toBe("disabled");
      process.env[KEY] = "review-only";
      expect(resolveLexiconIndexingMode()).toBe("review-only");
      process.env[KEY] = "nonsense";
      expect(resolveLexiconIndexingMode()).toBe("disabled");
    } finally {
      if (original === undefined) delete process.env[KEY];
      else process.env[KEY] = original;
    }
  });

  it("maps the ladder to capability so review-only can never index", () => {
    expect(lexiconIndexingReviews("disabled")).toBe(false);
    expect(lexiconIndexingReviews("review-only")).toBe(true);
    expect(lexiconIndexingReviews("index")).toBe(true);

    expect(lexiconIndexingExtracts("disabled")).toBe(false);
    expect(lexiconIndexingExtracts("review-only")).toBe(true);
    expect(lexiconIndexingExtracts("index")).toBe(true);

    expect(lexiconIndexingIndexes("disabled")).toBe(false);
    expect(lexiconIndexingIndexes("review-only")).toBe(false);
    expect(lexiconIndexingIndexes("index")).toBe(true);
  });
});
