/**
 * In-memory `CandidateReviewer` for tests, plus the frozen candidate fixture the
 * contract tests share.
 *
 * The seam already ships `createFakeCandidateReviewer` for pipeline tests; this
 * file exists so the *provider contract* tests have a network-free stand-in of
 * the same shape, and so the synthetic candidate used by the smoke script and by
 * the unit tests is defined once instead of being copy-pasted into each file
 * (a drift in that fixture would silently change what "the reviewer accepts").
 *
 * Nothing here touches the network, reads an environment variable or imports
 * `server-only`.
 */

import { ownerAuthorizedReviewerReference } from "@/src/modules/content-acquisition/domain/review-identity";
import type {
  CandidateReviewDecision,
  CandidateReviewRequest,
  CandidateReviewer,
} from "@/src/modules/lexicon-corpus/application/candidate-reviewer";
import type { LexiconCandidate } from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";

/** Fixed clock so a fixture never depends on when the test ran. */
export const fakeLexiconReviewNow = new Date("2026-10-11T00:00:00.000Z");

/**
 * A synthetic frozen candidate: invented text, invented source, no user data.
 * `review_submitted` + revision 2 is the state the pipeline reviews in.
 */
export function fakeLexiconReviewCandidate(overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  return {
    id: "lexeme|article|fake.review.001|1|0|terremoto",
    kind: "lexeme",
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    meaningZh: null,
    status: "review_submitted",
    revision: 2,
    source: {
      documentKind: "article",
      documentStableKey: "fake.review.001",
      documentVersion: 1,
      segmentIndex: 0,
      contextBefore: "Y en Panamá, un",
      contextAfter: "de magnitud 7.2 sacudió el sureste del país.",
      sourceTitle: "Alerta de tsunami en el Pacífico",
      sourceKind: "article-rss",
    },
    reviews: [],
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: fakeLexiconReviewNow,
    updatedAt: fakeLexiconReviewNow,
    ...overrides,
  };
}

export type FakeLexiconCandidateReviewerOptions = Readonly<{
  /** Verdict per dimension; anything unset passes. */
  outcomes?: Partial<Record<CandidateReviewRequest["dimension"], CandidateReviewDecision["outcome"]>>;
  reviewerReference?: string;
  reviewedAt?: Date;
  /** Answer with a hand-built decision instead of the per-dimension verdict. */
  respond?: (input: CandidateReviewRequest) => CandidateReviewDecision;
  /** Throw instead of answering. */
  error?: Error;
}>;

export type FakeLexiconCandidateReviewer = CandidateReviewer &
  Readonly<{ calls: readonly CandidateReviewRequest[] }>;

/** A network-free reviewer whose verdicts and failures a test can pin exactly. */
export function createFakeLexiconCandidateReviewer(
  options: FakeLexiconCandidateReviewerOptions = {},
): FakeLexiconCandidateReviewer {
  const calls: CandidateReviewRequest[] = [];
  const reviewerReference =
    options.reviewerReference ?? ownerAuthorizedReviewerReference({ actor: "fake-lexicon-review" });

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
        reviewedAt: options.reviewedAt ?? fakeLexiconReviewNow,
      };
    },
  };
}
