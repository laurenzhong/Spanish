/**
 * `CandidateReviewer` seam (LEX-INDEX-001 slice 6).
 *
 * Reviewing must not be done by the thing that proposed the candidate. If the
 * extraction provider could answer "and I also think this is correct", the dual
 * review would be self-certification and the owner gate would be decorative.
 * This module therefore defines a *separate* port from `LexemeCandidateProvider`:
 * the provider proposes, the reviewer judges, and the pipeline (see
 * `lexicon-indexing-pipeline.ts`) only ever reads a verdict from this port.
 *
 * Shape of the contract, and why:
 *
 * - the input is a **frozen** `LexiconCandidate`. Document kind, stable key,
 *   version, segment index and the extraction-time text are already on it, so a
 *   later content edit cannot move the judgement onto different text. `status`
 *   and `revision` travel with the snapshot but are *not* judgement inputs: a
 *   reviewer judges the language, never whether the candidate "looks ready";
 * - one call answers **one dimension** and returns exactly one decision. The two
 *   dimensions (`content-es-ES`, `teaching-zh-CN`) are independent judgements
 *   with different costs, so a single "reviewed: true" boolean is not expressible
 *   here and a reviewer cannot pass both dimensions by accident;
 * - the decision carries `reviewerReference`, which the application layer
 *   validates through the shared
 *   `isOwnerAuthorizedReviewerReference()` authority. A reviewer implementation
 *   cannot invent an identity that the corpus gate would reject, and the pipeline
 *   rejects an unauthorised reference *before* writing anything.
 *
 * ## Where the real implementation's cost sits
 *
 * Not in this file, and not in the pipeline. A production reviewer is a
 * server-only adapter (the same layering as
 * `src/modules/providers/lexicon-extraction/minimax-lexicon-extraction.ts`)
 * that, per candidate, performs **two** LLM calls against MiniMax:
 *
 * 1. `content-es-ES` — Spanish linguistic review (lemma, part of speech,
 *    inflection, whether the surface form is a legitimate corpus entry);
 * 2. `teaching-zh-CN` — Chinese teaching review (`meaningZh` correctness and
 *    learner-facing register).
 *
 * That is the entire marginal cost of the pipeline: two provider calls per
 * candidate, plus one extraction call per batch. Cost is why `maxCandidatesPerSegment`
 * is bounded, why the switch defaults to `disabled`, and why the pipeline records
 * the provider's model version and estimated cost in its result (AGENTS.md §7).
 * A real adapter must also declare its AI identity: the reference written is
 * `dsh-ai-owner-authorized-review...` and the record must never describe the
 * reviewer as a human, native speaker or teaching expert (AGENTS.md §8).
 *
 * The fake below is the only implementation this slice ships, and it never
 * touches the network.
 */

import {
  ownerAuthorizedReviewerReference,
} from "@/src/modules/content-acquisition/domain/review-identity";

import type {
  LexiconCandidate,
  LexiconReviewDimension,
  LexiconReviewOutcome,
} from "../domain/lexicon-candidate";

/**
 * One dimension's verdict on one frozen candidate.
 *
 * Field-for-field the review row the domain records, so the pipeline can hand it
 * straight to `recordCandidateReview()` without a translation step.
 */
export type CandidateReviewDecision = Readonly<{
  dimension: LexiconReviewDimension;
  outcome: LexiconReviewOutcome;
  /** Must satisfy `isOwnerAuthorizedReviewerReference()`; the pipeline checks it. */
  reviewerReference: string;
  reviewedAt: Date;
}>;

export type CandidateReviewRequest = Readonly<{
  /** The frozen snapshot extracted from published content. */
  candidate: LexiconCandidate;
  /** Which of the two dimensions this call must answer. */
  dimension: LexiconReviewDimension;
}>;

export interface CandidateReviewer {
  /**
   * Judge exactly the requested dimension of the frozen candidate.
   *
   * Implementations must not resolve, approve or index anything, and must not
   * write to any store: they answer one question. `signal` is the caller's
   * cancellation handle, mirroring the extraction provider's contract.
   */
  review(
    input: CandidateReviewRequest,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<CandidateReviewDecision>;
}

export type FakeCandidateReviewerOptions = Readonly<{
  /**
   * Verdict per dimension; anything unset passes. Set one dimension to `fail` to
   * exercise the settle-as-`rejected` path.
   */
  outcomes?: Partial<Record<LexiconReviewDimension, LexiconReviewOutcome>>;
  /**
   * Review identity. Defaults to an owner-authorized reference built through
   * `ownerAuthorizedReviewerReference()`, so the fake cannot accidentally model
   * an authorised-looking identity the real gate would refuse.
   */
  reviewerReference?: string;
  /** Timestamp recorded on every decision. */
  reviewedAt?: Date;
  /**
   * Replace the verdicts entirely. Used to model a reviewer that answers the
   * wrong dimension, returns an unauthorised reference or returns a bad date.
   */
  respond?: (input: CandidateReviewRequest) => CandidateReviewDecision | Promise<CandidateReviewDecision>;
  /** Throw instead of answering, to exercise the review-failure path. */
  error?: Error;
}>;

/** The fake plus the call log, so a test can assert how often review was asked. */
export type FakeCandidateReviewer = CandidateReviewer & Readonly<{
  /** Every request answered so far, in call order. A copy, not live state. */
  readonly calls: readonly CandidateReviewRequest[];
}>;

export function createFakeCandidateReviewer(options: FakeCandidateReviewerOptions = {}): FakeCandidateReviewer {
  const calls: CandidateReviewRequest[] = [];
  const reviewerReference =
    options.reviewerReference ?? ownerAuthorizedReviewerReference({ actor: "fake-lexicon-review" });
  const reviewedAt = options.reviewedAt ?? new Date();

  return {
    get calls(): readonly CandidateReviewRequest[] {
      return calls.slice();
    },
    async review(input: CandidateReviewRequest): Promise<CandidateReviewDecision> {
      calls.push(input);
      if (options.error) throw options.error;
      if (options.respond) return options.respond(input);
      return {
        dimension: input.dimension,
        outcome: options.outcomes?.[input.dimension] ?? "pass",
        reviewerReference,
        reviewedAt,
      };
    },
  };
}
