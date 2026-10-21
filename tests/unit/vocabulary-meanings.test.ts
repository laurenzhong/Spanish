import { describe, expect, it } from "vitest";

import {
  displayMeanings,
  languageReactorMeaningOrder,
  parseMeaningAsset,
  vocabularyMeaningLimit,
} from "@/src/modules/lexicon-corpus/ui/vocabulary-meanings";

/**
 * The meaning contract: Language Reactor's translations when the asset has the
 * word, otherwise the reviewed glossary's own meanings, otherwise nothing. The
 * asset's order is used exactly as given — it is LR's order, not a frequency
 * order, and no index may be presented as commonness.
 */
describe("meaning asset", () => {
  it("reads the documented shape and keeps every list exactly as given", () => {
    const asset = parseMeaningAsset({
      order: languageReactorMeaningOrder,
      meanings: { casa: ["家", "房子", "住宅"], ser: ["是", "为", "存在"], agua: ["水"] },
    });

    expect(asset.available).toBe(true);
    expect(asset.order).toBe(languageReactorMeaningOrder);
    expect(asset.meanings.casa).toEqual(["家", "房子", "住宅"]);
    // Never padded: a one-meaning word stays a one-meaning word.
    expect(asset.meanings.agua).toEqual(["水"]);
  });

  it("trims, drops blanks and duplicates, and caps at three without adding anything", () => {
    const asset = parseMeaningAsset({
      meanings: { casa: ["  家  ", "", "家", "房子", "住宅", "住处", "居所"] },
    });

    expect(asset.meanings.casa).toEqual(["家", "房子", "住宅"]);
    expect(asset.meanings.casa).toHaveLength(vocabularyMeaningLimit);
  });

  it("never re-sorts: the order it is handed is the order it keeps", () => {
    const asset = parseMeaningAsset({ meanings: { banco: ["长椅", "银行", "库存"] } });

    // LR's own answer for `banco` (the English side shows bench before bank):
    // sorting this by anything would be inventing a ranking.
    expect(asset.meanings.banco).toEqual(["长椅", "银行", "库存"]);
  });

  it("reports a missing or unrecognisable asset instead of guessing at it", () => {
    expect(parseMeaningAsset(null).available).toBe(false);
    expect(parseMeaningAsset({ meanings: [] }).available).toBe(false);
    expect(parseMeaningAsset({ meanings: "casa" }).available).toBe(false);
    expect(parseMeaningAsset({ entries: [{ word: "casa" }] }).available).toBe(false);
    expect(parseMeaningAsset({ meanings: { casa: [] } })).toMatchObject({ available: true, meanings: {} });
  });

  it("drops entries that are not a usable list of strings", () => {
    const asset = parseMeaningAsset({
      meanings: { casa: ["家", 7, null], casa2: "家", "  ": ["家"] },
    });

    expect(asset.meanings).toEqual({ casa: ["家"] });
  });
});

describe("displayed meanings", () => {
  it("takes Language Reactor's list when the asset has the word, tile and hover from one function", () => {
    const display = displayMeanings({ languageReactor: ["家", "房子", "住宅"], glossary: [{ meaning: "房子、家", usage: "en casa 表示在家" }] });

    expect(display.source).toBe("language-reactor");
    expect(display.meanings.map((meaning) => meaning.meaning)).toEqual(["家", "房子", "住宅"]);
    // The tile reads the same list's first entry, so they cannot disagree.
    expect(display.meanings[0]?.meaning).toBe("家");
  });

  it("shows one or two meanings when that is all there is", () => {
    expect(displayMeanings({ languageReactor: ["水"], glossary: undefined }).meanings).toHaveLength(1);
    expect(displayMeanings({ languageReactor: ["家", "房子"], glossary: undefined }).meanings.map((meaning) => meaning.meaning)).toEqual(["家", "房子"]);
  });

  it("falls back to the reviewed glossary's own order for a word the scrape missed", () => {
    const display = displayMeanings({ languageReactor: undefined, glossary: [{ meaning: "房子、家", usage: "en casa 表示在家" }, { meaning: "家、住所", usage: "" }] });

    expect(display.source).toBe("reviewed-glossary");
    expect(display.meanings.map((meaning) => meaning.meaning)).toEqual(["房子、家", "家、住所"]);
  });

  it("shows nothing at all when neither source has the word", () => {
    const display = displayMeanings({ languageReactor: undefined, glossary: undefined });

    expect(display.source).toBe("none");
    expect(display.meanings).toEqual([]);
  });

  it("does not let an empty Language Reactor list fall through as a meaning", () => {
    const display = displayMeanings({ languageReactor: [], glossary: [{ meaning: "水", usage: "" }] });

    expect(display.source).toBe("reviewed-glossary");
    expect(display.meanings.map((meaning) => meaning.meaning)).toEqual(["水"]);
  });

  it("never blends the two sources into one list", () => {
    const display = displayMeanings({ languageReactor: ["家"], glossary: [{ meaning: "房子、家", usage: "en casa 表示在家" }] });

    expect(display.meanings.map((meaning) => meaning.meaning)).toEqual(["家"]);
    expect(display.meanings).toHaveLength(1);
  });

  it("keeps LR's list at the three-meanings limit even if handed more", () => {
    const display = displayMeanings({ languageReactor: ["一", "二", "三", "四"], glossary: undefined });

    expect(display.meanings.map((meaning) => meaning.meaning)).toEqual(["一", "二", "三"]);
  });

  it("ignores blanks so a padded asset cannot widen a list", () => {
    const display = displayMeanings({ languageReactor: [" ", "家", "", "房子"], glossary: undefined });

    expect(display.meanings.map((meaning) => meaning.meaning)).toEqual(["家", "房子"]);
  });
});
