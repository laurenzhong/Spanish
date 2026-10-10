import {
  LexiconExtractionError,
  validateLexiconCandidateProposals,
  validateLexiconExtractionInput,
  type LexemeCandidateProvider,
  type LexiconCandidateProposal,
  type LexiconExtractionInput,
  type LexiconExtractionResult,
  type LexiconExtractionSegment,
} from "./lexicon-extraction";

/**
 * Deterministic extraction provider for tests and offline development.
 *
 * It performs no network work and never touches a corpus table. Its proposals
 * come from simple, explainable rules so tests can assert exact output; real
 * extraction quality is the MiniMax adapter's concern, and nothing here should
 * be read as a linguistic judgement.
 */

/** Stand-in for a real tokenizer. Splits on whitespace and strips edge punctuation. */
function surfaceForms(sourceText: string): readonly string[] {
  return sourceText
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((token) => token.length > 0);
}

function normalize(surface: string): string {
  return surface.toLocaleLowerCase("es");
}

/** Prose-like forms only. The fake cannot know part of speech, so it claims none. */
function isProseCandidate(surface: string): boolean {
  return surface.length >= 3 && /^\p{L}+$/u.test(surface);
}

export function createFakeLexemeCandidateProvider(): LexemeCandidateProvider {
  return {
    async extractCandidates(
      input: LexiconExtractionInput,
      options?: Readonly<{ signal?: AbortSignal }>,
    ): Promise<LexiconExtractionResult> {
      const startedAt = Date.now();
      validateLexiconExtractionInput(input);

      if (options?.signal?.aborted) {
        throw new LexiconExtractionError("provider-cancelled", "Extraction was cancelled.", false);
      }

      const proposals: LexiconCandidateProposal[] = [];

      for (const segment of input.segments) {
        if (options?.signal?.aborted) {
          throw new LexiconExtractionError("provider-cancelled", "Extraction was cancelled.", false);
        }

        // A whole segment with a translation is the natural phrase candidate,
        // matching how the shelf presents a saved sentence.
        if (segment.translation?.trim()) {
          proposals.push({
            kind: "phrase",
            surfaceText: segment.sourceText.trim(),
            normalizedText: normalize(segment.sourceText.trim()),
            lemma: null,
            partOfSpeech: null,
            meaningZh: segment.translation.trim(),
            segmentIndex: segment.segmentIndex,
            confidence: 1,
          });
        }

        for (const word of surfaceForms(segment.sourceText).filter(isProseCandidate)) {
          proposals.push({
            kind: "lexeme",
            surfaceText: word,
            normalizedText: normalize(word),
            lemma: normalize(word),
            // Claiming a part of speech here would fabricate a linguistic fact.
            partOfSpeech: null,
            meaningZh: null,
            segmentIndex: segment.segmentIndex,
            confidence: 1,
          });
        }
      }

      // Enforce the caller's bound per segment, deterministically.
      const perSegment = new Map<number, number>();
      const bounded = proposals.filter((proposal) => {
        const used = perSegment.get(proposal.segmentIndex) ?? 0;
        if (used >= input.maxCandidatesPerSegment) return false;
        perSegment.set(proposal.segmentIndex, used + 1);
        return true;
      });

      validateLexiconCandidateProposals(bounded, input.segments);

      return {
        proposals: bounded,
        safety: {
          audioSent: false,
          writesEvidence: false,
          affectsMastery: false,
          affectsConfidence: false,
          needsOwnerApproval: true,
        },
        provider: "fake",
        modelVersion: "fake-lexicon-extraction-v1",
        providerRequestId: null,
        latencyMs: Math.max(0, Date.now() - startedAt),
        estimatedCostMicros: 0,
      };
    },
  };
}

/** Convenience for tests that only need one segment. */
export function fakeSegment(overrides: Partial<LexiconExtractionSegment> = {}): LexiconExtractionSegment {
  return {
    documentKind: "article",
    documentStableKey: "article.a",
    documentVersion: 1,
    segmentIndex: 0,
    sourceText: "Y en Panamá un terremoto de magnitud 7.2 acudió el sureste del país.",
    translation: "在巴拿马，一场7.2级地震袭击了该国东南部。",
    sourceTitle: "Alerta de tsunami",
    sourceKind: "article-rss",
    ...overrides,
  };
}
