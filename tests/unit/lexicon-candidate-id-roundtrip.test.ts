import { describe, expect, it } from "vitest";

import { makeCandidateId } from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";
import { parseDerivedCandidateId } from "@/src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-repository";

/**
 * The derived candidate id and its parser must stay inverses.
 *
 * `makeCandidateId()` and `parseDerivedCandidateId()` live in different modules
 * and are joined only by a string format, so nothing structural keeps them in
 * step. That is exactly how they drifted: `documentKind` was added to the id so
 * it would line up with the table's identity unique index, and this parser was
 * not updated. It then read `documentKind` as the stable key and failed its next
 * `(\d+)` against the real stable key, matched nothing, and returned `null` —
 * so the Postgres repository's `findById` returned `null` for every id the
 * current `makeCandidateId()` can produce.
 *
 * Neither type checking nor any existing test could catch it: the returned shape
 * is a subset of what the caller needs and the caller handled `null` fine, and
 * the in-memory repository keys rows by the six columns directly and never
 * parses an id. It was found only by executing a real query. These cases are the
 * cheapest possible guard, because they need no database at all.
 */

const base = {
  kind: "lexeme" as const,
  documentKind: "article" as const,
  stableKey: "article.a",
  version: 1,
  segmentIndex: 0,
  normalizedText: "terremoto",
};

describe("the derived id round-trips through its parser", () => {
  it("recovers every field makeCandidateId encoded", () => {
    const parsed = parseDerivedCandidateId(makeCandidateId(base));

    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({
      kind: "lexeme",
      documentKind: "article",
      documentStableKey: "article.a",
      documentVersion: 1,
      segmentIndex: 0,
      normalizedText: "terremoto",
    });
  });

  it("recovers documentKind, which is what the identity unique index needs", () => {
    // The regression: without documentKind in the pattern this returns null for
    // both ids, and a lookup cannot be narrowed to one row.
    const article = parseDerivedCandidateId(makeCandidateId({ ...base, documentKind: "article" }));
    const media = parseDerivedCandidateId(makeCandidateId({ ...base, documentKind: "media" }));

    expect(article?.documentKind).toBe("article");
    expect(media?.documentKind).toBe("media");
  });

  it("does not confuse the document kind with the stable key", () => {
    // The original symptom: the kind was captured as the stable key.
    const parsed = parseDerivedCandidateId(makeCandidateId(base));
    expect(parsed?.documentStableKey).toBe("article.a");
    expect(parsed?.documentStableKey).not.toBe("article");
  });

  it("keeps version and segment index numeric", () => {
    const parsed = parseDerivedCandidateId(
      makeCandidateId({ ...base, version: 7, segmentIndex: 12 }),
    );
    expect(parsed?.documentVersion).toBe(7);
    expect(parsed?.segmentIndex).toBe(12);
  });

  it("survives a stable key containing dots, as real document keys do", () => {
    const parsed = parseDerivedCandidateId(
      makeCandidateId({ ...base, stableKey: "yt_NbwJNoL9EoM" }),
    );
    expect(parsed?.documentStableKey).toBe("yt_NbwJNoL9EoM");
  });

  it("round-trips a normalized text that contains spaces and accents", () => {
    const parsed = parseDerivedCandidateId(
      makeCandidateId({ ...base, normalizedText: "cerca de" }),
    );
    expect(parsed?.normalizedText).toBe("cerca de");
  });

  it("round-trips every kind and document kind combination", () => {
    for (const kind of ["lexeme", "phrase"] as const) {
      for (const documentKind of ["article", "media"] as const) {
        const parsed = parseDerivedCandidateId(makeCandidateId({ ...base, kind, documentKind }));
        expect(parsed?.kind).toBe(kind);
        expect(parsed?.documentKind).toBe(documentKind);
      }
    }
  });

  it("refuses an id it could not have produced rather than guessing", () => {
    // A stable key containing the separator is genuinely ambiguous, because the
    // join is not escapable.
    expect(parseDerivedCandidateId("lexeme|article|a|b|1|0|terremoto")).toBeNull();
    // Unknown kinds and document kinds are not silently coerced.
    expect(parseDerivedCandidateId("word|article|article.a|1|0|terremoto")).toBeNull();
    expect(parseDerivedCandidateId("lexeme|podcast|article.a|1|0|terremoto")).toBeNull();
    // The five-field shape that the parser used to expect is no longer valid.
    expect(parseDerivedCandidateId("lexeme|article.a|1|0|terremoto")).toBeNull();
    expect(parseDerivedCandidateId("")).toBeNull();
  });
});
