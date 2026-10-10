import { describe, expect, it } from "vitest";

import {
  createFakeLexemeCandidateProvider,
  fakeSegment,
  LexiconExtractionError,
  validateLexiconCandidateProposals,
  validateLexiconExtractionInput,
  type LexiconCandidateProposal,
  type LexiconExtractionSegment,
} from "@/src/modules/providers/lexicon-extraction";

function proposal(overrides: Partial<LexiconCandidateProposal> = {}): LexiconCandidateProposal {
  return {
    kind: "lexeme",
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: null,
    meaningZh: null,
    segmentIndex: 0,
    confidence: 1,
    ...overrides,
  };
}

describe("lexicon extraction contract", () => {
  it("produces one phrase candidate per translated segment and lexeme candidates per prose word", async () => {
    const provider = createFakeLexemeCandidateProvider();
    const result = await provider.extractCandidates({
      language: "es",
      segments: [fakeSegment()],
      maxCandidatesPerSegment: 50,
    });

    const phrases = result.proposals.filter((item) => item.kind === "phrase");
    const lexemes = result.proposals.filter((item) => item.kind === "lexeme");

    expect(phrases).toHaveLength(1);
    expect(phrases[0].meaningZh).toBe("在巴拿马，一场7.2级地震袭击了该国东南部。");
    expect(phrases[0].lemma).toBeNull();

    // Every prose word of length >= 3 becomes a lexeme candidate.
    expect(lexemes.map((item) => item.surfaceText)).toContain("terremoto");
    expect(lexemes.map((item) => item.surfaceText)).toContain("Panamá");
    // Short tokens and pure numbers are not proposed as lexemes.
    expect(lexemes.map((item) => item.surfaceText)).not.toContain("un");
    expect(lexemes.map((item) => item.surfaceText)).not.toContain("el");
  });

  it("never claims a part of speech or evidence side effects", async () => {
    const provider = createFakeLexemeCandidateProvider();
    const result = await provider.extractCandidates({
      language: "es",
      segments: [fakeSegment()],
      maxCandidatesPerSegment: 50,
    });

    // A fabricated part of speech would be a false linguistic fact.
    for (const item of result.proposals) expect(item.partOfSpeech).toBeNull();

    expect(result.safety).toEqual({
      audioSent: false,
      writesEvidence: false,
      affectsMastery: false,
      affectsConfidence: false,
      needsOwnerApproval: true,
    });
    expect(result.provider).toBe("fake");
    expect(result.estimatedCostMicros).toBe(0);
  });

  it("is deterministic for the same input", async () => {
    const provider = createFakeLexemeCandidateProvider();
    const input = { language: "es", segments: [fakeSegment()], maxCandidatesPerSegment: 50 };
    const first = await provider.extractCandidates(input);
    const second = await provider.extractCandidates(input);
    expect(second.proposals).toEqual(first.proposals);
  });

  it("honours the per-segment candidate bound", async () => {
    const provider = createFakeLexemeCandidateProvider();
    const result = await provider.extractCandidates({
      language: "es",
      segments: [fakeSegment()],
      maxCandidatesPerSegment: 3,
    });
    expect(result.proposals).toHaveLength(3);
    expect(result.proposals.every((item) => item.segmentIndex === 0)).toBe(true);
  });

  it("bounds each segment independently", async () => {
    const provider = createFakeLexemeCandidateProvider();
    const result = await provider.extractCandidates({
      language: "es",
      segments: [
        fakeSegment({ segmentIndex: 0 }),
        fakeSegment({ segmentIndex: 1, sourceText: "El sismo provocó daños menores.", translation: null }),
      ],
      maxCandidatesPerSegment: 2,
    });
    expect(result.proposals.filter((item) => item.segmentIndex === 0)).toHaveLength(2);
    expect(result.proposals.filter((item) => item.segmentIndex === 1)).toHaveLength(2);
  });

  it("refuses a non-Spanish batch before doing any work", async () => {
    const provider = createFakeLexemeCandidateProvider();
    await expect(
      provider.extractCandidates({ language: "en", segments: [fakeSegment()], maxCandidatesPerSegment: 10 }),
    ).rejects.toThrow(LexiconExtractionError);

    await expect(
      provider.extractCandidates({ language: "en", segments: [fakeSegment()], maxCandidatesPerSegment: 10 }),
    ).rejects.toMatchObject({ code: "input-invalid", retryable: false });
  });

  it("propagates cancellation without emitting candidates", async () => {
    const provider = createFakeLexemeCandidateProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.extractCandidates(
        { language: "es", segments: [fakeSegment()], maxCandidatesPerSegment: 10 },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "provider-cancelled", retryable: false });
  });

  it("rejects an invalid batch shape outright", () => {
    expect(() => validateLexiconExtractionInput({ language: "es", segments: [], maxCandidatesPerSegment: 0 })).toThrow(
      LexiconExtractionError,
    );
    expect(() =>
      validateLexiconExtractionInput({
        language: "es",
        segments: [fakeSegment({ documentVersion: 0 })],
        maxCandidatesPerSegment: 10,
      }),
    ).toThrow(LexiconExtractionError);
    expect(() =>
      validateLexiconExtractionInput({
        language: "es",
        segments: [fakeSegment({ sourceText: "   " })],
        maxCandidatesPerSegment: 10,
      }),
    ).toThrow(LexiconExtractionError);
  });

  it("fails the whole batch when a provider response is malformed", () => {
    const segments = [fakeSegment()];

    // Segment outside the request.
    expect(() => validateLexiconCandidateProposals([proposal({ segmentIndex: 9 })], segments)).toThrow(
      LexiconExtractionError,
    );
    // A lexeme carrying a phrase translation.
    expect(() => validateLexiconCandidateProposals([proposal({ meaningZh: "地震" })], segments)).toThrow(
      LexiconExtractionError,
    );
    // A phrase carrying a lemma.
    expect(() =>
      validateLexiconCandidateProposals([proposal({ kind: "phrase", lemma: "terremoto" })], segments),
    ).toThrow(LexiconExtractionError);
    // Confidence out of range.
    expect(() => validateLexiconCandidateProposals([proposal({ confidence: 1.5 })], segments)).toThrow(
      LexiconExtractionError,
    );
    // Part of speech outside the controlled set.
    expect(() => validateLexiconCandidateProposals([proposal({ partOfSpeech: "NOUNISH" })], segments)).toThrow(
      LexiconExtractionError,
    );
  });

  it("accepts a part of speech from the controlled set", () => {
    const segments = [fakeSegment()];
    expect(() => validateLexiconCandidateProposals([proposal({ partOfSpeech: "NOUN" })], segments)).not.toThrow();
    expect(() => validateLexiconCandidateProposals([proposal({ partOfSpeech: null })], segments)).not.toThrow();
  });

  it("emits phrase candidates only for translated segments", async () => {
    const provider = createFakeLexemeCandidateProvider();
    const untranslated: LexiconExtractionSegment = fakeSegment({ translation: null });
    const result = await provider.extractCandidates({
      language: "es",
      segments: [untranslated],
      maxCandidatesPerSegment: 50,
    });
    expect(result.proposals.filter((item) => item.kind === "phrase")).toHaveLength(0);
    expect(result.proposals.length).toBeGreaterThan(0);
  });
});
