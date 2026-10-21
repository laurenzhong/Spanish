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
import { tokenizeSpanish } from "../domain/spanish-token";
import type {
  LexemeCandidateProvider,
  LexiconCandidateProposal,
  LexiconExtractionInput,
  LexiconExtractionResult,
} from "@/src/modules/providers/lexicon-extraction/lexicon-extraction";

/**
 * The forms the shelf holds, keyed by **case-folded surface**, accents kept.
 *
 * Not accent-folded, and that is the correction of a real bug: this used to key on
 * `normalizeSpanishSurface`, which maps `ñ` to `n`, so the list's `uña` produced
 * the key `una` and the article `una` — which is **not** in the reference list, and
 * is filtered as a function word — passed the membership test and inherited
 * `uña`'s gloss 指甲. Five such candidates were stored before the reviewer caught
 * it. Case folding alone still lets `Casi` find `casi`, which was the reason to
 * normalise at all.
 */
export function referenceListForms(): ReadonlySet<string> {
  return new Set(contentFrequencyWords().map((entry) => surfaceKey(entry.word)));
}

/** Case-folded surface form: the key both membership and glosses are matched on. */
export function surfaceKey(surface: string): string {
  return surface.trim().toLocaleLowerCase("es");
}

/**
 * Read the learner-facing glosses out of the Language Reactor meaning asset.
 *
 * Pure and total: anything that is not the documented `{ meanings: { word: [..] } }`
 * shape yields an empty map, so a missing or malformed asset makes this source
 * propose candidates *without* glosses — which the teaching dimension then fails
 * visibly — rather than crashing the run or inventing a meaning.
 *
 * Keys are **case-folded, not accent-folded** — see {@link referenceListForms}:
 * accent folding made `uña` and `una` the same key, which attached a fingernail's
 * gloss to an article. Folding case is all that is needed for `Casi` to find
 * `casi`.
 *
 * Only the first gloss is used. The asset holds up to three and a candidate
 * carries one `meaningZh` — the same one the shelf's tile leads with, so the
 * entry and the shelf cannot disagree about which meaning leads.
 */
export function parseReferenceMeanings(asset: unknown): ReadonlyMap<string, string> {
  const meanings = new Map<string, string>();
  if (!asset || typeof asset !== "object") return meanings;
  const table = (asset as { meanings?: unknown }).meanings;
  if (!table || typeof table !== "object" || Array.isArray(table)) return meanings;
  for (const [word, value] of Object.entries(table as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const first = value.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
    if (!first) continue;
    meanings.set(surfaceKey(word), first.trim());
  }
  return meanings;
}

/**
 * Propose the reference-list forms that occur in this run's segments.
 *
 * One proposal per **form**, not per (form, segment): the first occurrence in
 * document order wins, and a word occurring twice is not two entries. That is a
 * cost property, not tidiness — measured before the rule, `casa` appearing in
 * three of six segments produced three candidates, each costing two review calls,
 * which quietly undoes the reason this source exists: one candidate per word is
 * what replaced the 147-day corpus sweep. "First occurrence in document order" is
 * also deterministic, so a re-run produces the same candidates, and the reviewer
 * still sees a real context rather than a synthesised one.
 *
 * The per-segment cap still applies, exactly as it does to the extractor's
 * proposals: it is the pipeline's bound on batch size.
 *
 * `confidence` is 1 for a reason that is not a model judgement: the form was
 * found as a token of the segment, which is a fact, not an estimate. It is
 * informational and never a publication gate.
 *
 * `meanings` supplies the Chinese gloss the teaching dimension judges. Without
 * it every candidate fails that dimension for a missing field — measured: 13 of
 * 13 candidates failed with `meaningZh is null` while 13 of 13 passed the Spanish
 * dimension — which is why the runner reads the Language Reactor asset and passes
 * it in, at no vendor cost.
 */
export function createReferenceListCandidateProvider(
  options: Readonly<{
    forms?: ReadonlySet<string>;
    meanings?: ReadonlyMap<string, string>;
  }> = {},
): LexemeCandidateProvider {
  const forms = options.forms ?? referenceListForms();
  const meanings = options.meanings ?? new Map<string, string>();
  return {
    async extractCandidates(input: LexiconExtractionInput): Promise<LexiconExtractionResult> {
      const proposals: LexiconCandidateProposal[] = [];
      // Run-wide, so the first occurrence in document order is the candidate.
      const proposedInRun = new Set<string>();
      for (const segment of input.segments) {
        let proposedForSegment = 0;
        for (const token of tokenizeSpanish(segment.sourceText)) {
          if (proposedForSegment >= input.maxCandidatesPerSegment) break;
          // Membership is decided on the **surface**, not the folded token: the
          // folded form of `uña` is `una`, which is how the article `una` used to
          // slip through and take a fingernail's gloss.
          const key = surfaceKey(token.surface);
          if (!forms.has(key) || proposedInRun.has(key)) continue;
          proposedInRun.add(key);
          proposals.push({
            kind: "lexeme",
            surfaceText: token.surface,
            // The pipeline's identity stays the folded form; only membership and
            // the gloss lookup are surface-keyed.
            normalizedText: token.normalized,
            lemma: null,
            partOfSpeech: null,
            meaningZh: meanings.get(key) ?? null,
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
