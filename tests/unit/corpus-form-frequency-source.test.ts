// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CORPUS_FREQUENCY_SOURCE,
  LEXICON_FREQUENCY_SOURCE_ENV_KEY,
  resolveCorpusFrequencySource,
} from "@/src/modules/lexicon-corpus/repositories/corpus-form-frequency";

/**
 * The source switch.
 *
 * The default matters: `live` as a default would leave production on the
 * three-second query unless someone remembered an environment variable. The
 * safety here is built into the read path instead (a never-refreshed, emptied or
 * stale table falls back to the live scan), so the default can be the fast one.
 */
describe("corpus frequency source switch", () => {
  it("defaults to the materialised fast path", () => {
    expect(DEFAULT_CORPUS_FREQUENCY_SOURCE).toBe("materialised");
    expect(resolveCorpusFrequencySource({})).toBe("materialised");
    expect(resolveCorpusFrequencySource({ [LEXICON_FREQUENCY_SOURCE_ENV_KEY]: undefined })).toBe("materialised");
  });

  it("honours the explicit live opt-out, trimmed and case-folded", () => {
    expect(resolveCorpusFrequencySource({ LEXICON_FREQUENCY_SOURCE: "live" })).toBe("live");
    expect(resolveCorpusFrequencySource({ LEXICON_FREQUENCY_SOURCE: "  LIVE " })).toBe("live");
    expect(resolveCorpusFrequencySource({ LEXICON_FREQUENCY_SOURCE: "materialised" })).toBe("materialised");
    expect(resolveCorpusFrequencySource({ LEXICON_FREQUENCY_SOURCE: " Materialised " })).toBe("materialised");
  });

  it("keeps the default for anything it does not recognise", () => {
    // A typo must not select a source by accident; it selects the default.
    for (const value of ["", "true", "yes", "1", "live-scan", "materialized"]) {
      expect(resolveCorpusFrequencySource({ LEXICON_FREQUENCY_SOURCE: value }), value).toBe(
        DEFAULT_CORPUS_FREQUENCY_SOURCE,
      );
    }
  });
});
