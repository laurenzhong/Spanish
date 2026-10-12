import { describe, expect, it } from "vitest";

import { createReferenceListCandidateProvider, parseReferenceMeanings } from "@/src/modules/lexicon-corpus/application/reference-list-candidate-provider";
import type { LexiconIndexingSegment } from "@/src/modules/lexicon-corpus/application/lexicon-indexing-pipeline";

/**
 * The reference-list candidate source.
 *
 * Its value is a bounded cost: one candidate per word means two review calls per
 * word, which is what replaced a 147-day corpus sweep. These tests pin the two
 * properties that cost depends on — one candidate per word, first occurrence in
 * document order — and the gloss attachment that turned a 0-of-13 run into
 * 18-of-37.
 */

function segment(index: number, sourceText: string): LexiconIndexingSegment {
  return {
    documentKind: "article",
    documentStableKey: "article.test",
    documentVersion: 1,
    segmentIndex: index,
    sourceText,
    translation: null,
    sourceTitle: "Prueba",
    sourceKind: "article-rss",
    paragraphId: `p${index}`,
  };
}

const forms = new Set(["casa", "madre", "dia"]);
const meanings = new Map([["casa", "房子"], ["madre", "妈妈"]]);

function provider(): ReturnType<typeof createReferenceListCandidateProvider> {
  return createReferenceListCandidateProvider({ forms, meanings });
}

describe("reference-list candidate source", () => {
  it("proposes a word once, from its first occurrence in document order", async () => {
    const result = await provider().extractCandidates({
      language: "es",
      segments: [
        segment(0, "Mi madre vive aquí."),
        segment(1, "La casa de mi madre es grande."),
        segment(2, "Vuelvo a casa."),
      ],
      maxCandidatesPerSegment: 12,
    });

    // `madre` appears in segments 0 and 1, `casa` in 1 and 2 — one candidate each,
    // from the earliest segment that contains it.
    expect(result.proposals.map((proposal) => `${proposal.normalizedText}@${proposal.segmentIndex}`)).toEqual([
      "madre@0",
      "casa@1",
    ]);
  });

  it("attaches the gloss, and only the form the segment contains", async () => {
    const result = await provider().extractCandidates({
      language: "es",
      segments: [segment(0, "La Casa es grande y mi Madre también.")],
      maxCandidatesPerSegment: 12,
    });

    const casa = result.proposals.find((proposal) => proposal.normalizedText === "casa");
    // The surface is the published spelling, the lookup is folded.
    expect(casa?.surfaceText).toBe("Casa");
    expect(casa?.meaningZh).toBe("房子");
    const madre = result.proposals.find((proposal) => proposal.normalizedText === "madre");
    expect(madre?.meaningZh).toBe("妈妈");
  });

  it("leaves an absent gloss null rather than inventing one", async () => {
    const result = await provider().extractCandidates({
      language: "es",
      segments: [segment(0, "Hoy es un día largo.")],
      maxCandidatesPerSegment: 12,
    });

    // `día` is a listed form with no meaning in the map: null, which the teaching
    // dimension then fails visibly.
    expect(result.proposals.map((proposal) => proposal.meaningZh)).toEqual([null]);
    expect(result.provider).toBe("reference-list");
    expect(result.estimatedCostMicros).toBe(0);
  });

  it("ignores forms outside the reference list and respects the per-segment cap", async () => {
    const result = await provider().extractCandidates({
      language: "es",
      segments: [segment(0, "madre casa día madre casa día")],
      maxCandidatesPerSegment: 2,
    });

    expect(result.proposals.map((proposal) => proposal.normalizedText)).toEqual(["madre", "casa"]);
    for (const proposal of result.proposals) {
      // No lemma and no part of speech: a reference-list form is a surface form,
      // and presenting it as a lemma is a claim nobody made.
      expect(proposal.lemma).toBeNull();
      expect(proposal.partOfSpeech).toBeNull();
    }
  });
});

describe("parseReferenceMeanings", () => {
  it("reads the documented shape and folds its keys", () => {
    const parsed = parseReferenceMeanings({ meanings: { Casa: ["房子", "家"], madre: ["妈妈"] } });
    expect(parsed.get("casa")).toBe("房子");
    expect(parsed.get("madre")).toBe("妈妈");
    // The first gloss is the one the shelf's tile leads with.
    expect(parsed.get("casa")).not.toBe("家");
  });

  it("is total: a malformed asset yields no glosses rather than throwing", () => {
    for (const asset of [null, 42, "text", {}, { meanings: [] }, { meanings: { casa: "房子" } }, { meanings: { casa: [] } }]) {
      expect([...parseReferenceMeanings(asset)]).toEqual([]);
    }
  });
});
