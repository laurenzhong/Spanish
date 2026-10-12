/**
 * The reference-list candidate source: candidates for the words the shelf holds,
 * taken from the committed reference list rather than invented by a model.
 *
 * ## Why this exists
 *
 * The segment extractor proposes whatever a language model notices in a batch of
 * segments. Measured on the real corpus, that path costs one extraction call per
 * document plus two review calls per candidate, and it yields roughly 7.75
 * candidates per segment — which over the 109,211 visible segments projects to
 * about 850,000 candidates and 1.7M review calls, or **147 days** at the measured
 * 8 calls per minute. Almost all of those candidates are words the shelf does not
 * show.
 *
 * This source inverts it. It proposes **only the 7,922 forms of the committed
 * reference list** (the same list the vocabulary shelf renders), and it is
 * deterministic: a form is proposed when it occurs as a token of a segment, which
 * the tokenizer already knows. There is no extraction call at all, so the run
 * costs exactly two review calls per candidate.
 *
 * ## What it deliberately does not claim
 *
 * `lemma` and `partOfSpeech` are left `null`. A reference-list form is a surface
 * form — the list contains `nuevas` and `dedos`, not `nuevo` and `dedo` — so
 * copying the surface into `lemma` would assert a linguistic claim nobody made.
 * `approve-candidate-indexing.ts` already refuses to index a lemma-less lexeme
 * for exactly that reason, which means these candidates can reach `review_ready`
 * and **cannot be indexed until a lemma exists**. That is a deliberate, visible
 * gap rather than a silent one; supplying a lemma is a separate decision (one
 * more paid call per word, or an owner-adjudicated lemma at approval).
 *
 * The Chinese gloss is likewise `null`: Language Reactor supplies learner-facing
 * meanings for the shelf, and the review dimension that judges teaching value
 * needs a gloss to judge. Leaving it empty is honest about what this source knows.
 */
import { contentFrequencyWords } from "../domain/frequency-word-list";
import { normalizeSpanishSurface, tokenizeSpanish } from "../domain/spanish-token";
import type {
  LexemeCandidateProvider,
  LexiconCandidateProposal,
  LexiconExtractionInput,
  LexiconExtractionResult,
} from "@/src/modules/providers/lexicon-extraction/lexicon-extraction";

/** The forms the shelf holds, folded, as the tokenizer reports them. */
export function referenceListForms(): ReadonlySet<string> {
  return new Set(contentFrequencyWords().map((entry) => normalizeSpanishSurface(entry.word)));
}

/**
 * Propose the reference-list forms that occur in this run's segments.
 *
 * One proposal per (form, segment) pair, in segment order, capped by
 * `maxCandidatesPerSegment` exactly as the extractor's proposals are — the cap is
 * the pipeline's bound on batch size, and this source respects it rather than
 * quietly exceeding it.
 *
 * `confidence` is 1 for a reason that is not a model judgement: the form was
 * found as a token of the segment, which is a fact, not an estimate. It is
 * informational and never a publication gate.
 */
export function createReferenceListCandidateProvider(
  forms: ReadonlySet<string> = referenceListForms(),
): LexemeCandidateProvider {
  return {
    async extractCandidates(input: LexiconExtractionInput): Promise<LexiconExtractionResult> {
      const proposals: LexiconCandidateProposal[] = [];
      for (const segment of input.segments) {
        const seen = new Set<string>();
        let proposedForSegment = 0;
        for (const token of tokenizeSpanish(segment.sourceText)) {
          if (proposedForSegment >= input.maxCandidatesPerSegment) break;
          const normalized = token.normalized;
          if (!forms.has(normalized) || seen.has(normalized)) continue;
          seen.add(normalized);
          proposals.push({
            kind: "lexeme",
            surfaceText: token.surface,
            normalizedText: normalized,
            lemma: null,
            partOfSpeech: null,
            meaningZh: null,
            segmentIndex: segment.segmentIndex,
            confidence: 1,
          });
          proposedForSegment += 1;
        }
      }
      return {
        proposals,
        provider: "reference-list",
        modelVersion: "reference-list-v1",
        // There is no vendor call to attribute: no request id, and the latency a
        // caller would measure is this process's own tokenising.
        providerRequestId: null,
        latencyMs: 0,
        // No vendor call happens, so there is nothing to price.
        estimatedCostMicros: 0,
        safety: {
          audioSent: false,
          writesEvidence: false,
          affectsMastery: false,
          affectsConfidence: false,
          needsOwnerApproval: true,
        },
      };
    },
  };
}
