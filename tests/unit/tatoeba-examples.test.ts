import { describe, expect, it } from "vitest";

import { parseTatoebaExampleAsset } from "@/src/modules/lexicon-corpus/application/tatoeba-examples";

/**
 * The asset is produced by `scripts/build-tatoeba-example-asset.ts` and read by the
 * shelf page, the panel and the word lookup. A shape disagreement between the two
 * sides does not throw — it silently yields "available, zero words", which is exactly
 * what happened when the builder wrote `{ word, examples }` and this parser expected a
 * bare array: every word lost its example and nothing reported an error. That is why
 * both shapes are covered here.
 */
const example = {
  text: "Hoy me quedo en casa.",
  translation: "今天我呆在家里。",
  sentenceId: 1234567,
  sentenceLicense: "CC BY 2.0 FR",
  sentenceOwner: "Shishir",
  translationId: 7654321,
  translationLicense: "CC BY 2.0 FR",
  translationOwner: "sadhen",
  isDirect: true,
  tags: ["whole-token", "script-hans"],
};

describe("parseTatoebaExampleAsset", () => {
  it("reads the builder's own shape, where each word wraps its examples", () => {
    const asset = parseTatoebaExampleAsset({
      license: "CC BY 2.0 FR",
      sourceUrl: "https://tatoeba.org",
      examples: { casa: { word: "casa", examples: [example] } },
    });
    expect(asset.available).toBe(true);
    expect(asset.license).toBe("CC BY 2.0 FR");
    expect(asset.examples.casa).toHaveLength(1);
    // The attribution the licence requires must survive the read, not just the fetch.
    expect(asset.examples.casa![0]).toMatchObject({
      sentenceId: 1234567,
      sentenceOwner: "Shishir",
      sentenceLicense: "CC BY 2.0 FR",
      translationOwner: "sadhen",
      translationLicense: "CC BY 2.0 FR",
    });
  });

  it("also reads a bare array, so either shape yields examples rather than silence", () => {
    const asset = parseTatoebaExampleAsset({ examples: { casa: [example] } });
    expect(asset.examples.casa).toHaveLength(1);
  });

  it("carries the inflected form the sentence matched, and defaults it when absent", () => {
    // The lemma rule means an example may not contain the headword at all (`Habéis` under
    // `haber`). The panel explains that with this field, so a reader that dropped it would
    // leave the sentence looking wrong — and the whitelist shape here is exactly what drops
    // unknown fields, which is how `matchedForm` was lost the first time.
    const asset = parseTatoebaExampleAsset({
      examples: {
        haber: { examples: [{ ...example, text: "¿Habéis despertado?", matchedForm: "Habéis" }] },
        casa: { examples: [example] },
      },
    });
    expect(asset.examples.haber![0]!.matchedForm).toBe("Habéis");
    // An asset built before the lemma rule has no such field, and that is not an error.
    expect(asset.examples.casa![0]!.matchedForm).toBeNull();
  });

  it("drops records without a sentence or a translation instead of showing half of one", () => {
    const asset = parseTatoebaExampleAsset({
      examples: {
        casa: { examples: [example, { text: "Sin traducción.", translation: "" }, { translation: "没有句子。" }] },
        vacio: { examples: [] },
      },
    });
    expect(asset.examples.casa).toHaveLength(1);
    // A word with nothing usable is absent rather than present-and-empty: the panel
    // asks whether there is an example, so an empty list and no list must not differ.
    expect(asset.examples.vacio).toBeUndefined();
  });

  it("reports an asset it cannot read as unavailable rather than as an empty shelf", () => {
    expect(parseTatoebaExampleAsset(null).available).toBe(false);
    expect(parseTatoebaExampleAsset({ examples: [] }).available).toBe(false);
    expect(parseTatoebaExampleAsset({ examples: { casa: "not a list" } }).available).toBe(true);
    expect(Object.keys(parseTatoebaExampleAsset({ examples: { casa: "not a list" } }).examples)).toHaveLength(0);
  });
});
