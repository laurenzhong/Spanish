/**
 * Lexicon indexing pipeline (LEX-INDEX-001 slice 6).
 *
 * One call runs the whole chain for one published document version:
 *
 * ```
 * extract → create → submitForReview → recordReview(content-es-ES)
 *         → recordReview(teaching-zh-CN) → approve → index
 * ```
 *
 * It is not wired into the daily content pipeline. That is slice 7, and it
 * depends on the `lexicon_candidates` migration being applied; this slice
 * produces a callable orchestrator plus the tests that lock its invariants.
 *
 * ## The invariants, and where each one is enforced
 *
 * 1. **Only `approved` reaches the corpus.** The corpus write goes through
 *    `indexApprovedCandidate()`, whose first line refuses every other status, and
 *    this module only calls it immediately after persisting an owner approval.
 *    A `discovered`, `review_submitted`, `review_ready` or `rejected` candidate
 *    produces zero index calls.
 * 2. **A run is idempotent.** `create()` is the storage identity's idempotent
 *    insert: when a row already exists the pipeline *rebases* onto the stored
 *    revision and continues from the stored status instead of overwriting it with
 *    the freshly extracted snapshot. Every write is a compare-and-swap on that
 *    stored revision, so a concurrent writer wins and the run reports a conflict
 *    rather than resetting state.
 * 3. **A run indexes only what it approves.** Approval and the corpus write are
 *    the last two steps of the same per-candidate commit, and the corpus write is
 *    skipped whenever the stored status is already `approved`. Re-running the
 *    pipeline therefore cannot index twice — not even after the approval is
 *    already on record.
 * 4. **One failing dimension rejects the candidate, permanently.** A `fail`
 *    verdict settles the candidate as `rejected` in Phase A (before any write) and
 *    the review loop stops, so the second dimension is not even called. Rejection
 *    is terminal in the state machine, so a later passing verdict cannot revive
 *    it.
 * 5. **A thrown extraction or review error leaves no partial state.** The run is
 *    split in two:
 *    - **Phase A (reads and external calls only):** extraction, the reviewer calls
 *      that are still needed, and every state transition computed on in-memory
 *      snapshots. A throw or an unusable verdict here aborts the run with zero
 *      repository writes;
 *    - **Phase B (writes):** insert/CAS-save each planned candidate, then approve
 *      and index the ones the run approved.
 *    Anything that can fail expensively or unpredictably (a network call, a model
 *    response) is exhaustively done in Phase A, before the first write exists.
 * 6. **No ability evidence, ever.** The pipeline has no evidence port and imports
 *    no evidence module: its only writers are the candidate repository, the
 *    approval-audit store and `indexContentVersion()`, which produce corpus facts
 *    and never `evidence_events`, `mastery` or `confidence` (ADR-0011 §6).
 * 7. **The switch defaults to off and fails closed.** See
 *    `lexicon-indexing-mode.ts`; `disabled` returns before the provider is called,
 *    and `index` mode additionally requires an owner-authorized `approvedBy` on
 *    the run input *and* an approval-audit store, both checked before any work.
 *
 * ## Ordering choice: approval is persisted before the corpus write
 *
 * A corpus write is idempotent (`indexLexeme`/`indexPhrase` use
 * `onConflictDoNothing`), while an approval is provenance: `verified` lemmas must
 * never exist without a recorded decision. So the pipeline saves the approved
 * candidate first and indexes second. If the corpus write then fails, the run
 * reports `INDEXING_CORPUS_WRITE_FAILED` and the candidate is left *approved but
 * unindexed* — a repairable state (`LexiconCandidateRepository.listIndexable()`
 * is the reconciliation input) rather than a corpus row nobody approved. The
 * reverse order would put an unapproved `verified` lemma into the corpus.
 *
 * ## What a run costs
 *
 * One extraction call for the batch, then **two reviewer calls per candidate**
 * (Spanish linguistic review + Chinese teaching review — see
 * `candidate-reviewer.ts`), and only for candidates whose verdicts are not already
 * on record: a repeat run over the same document version re-reads the stored rows
 * and pays nothing for candidates that are already reviewed or settled.
 * `maxCandidatesPerSegment` bounds the batch size; the provider's model version
 * and estimated cost are reported back on the result.
 */

import { isOwnerAuthorizedReviewerReference } from "@/src/modules/content-acquisition/domain/review-identity";
import {
  LexiconExtractionError,
  isLexiconPartOfSpeech,
  type LexemeCandidateProvider,
  type LexiconCandidateProposal,
  type LexiconExtractionResult,
  type LexiconExtractionSegment,
} from "@/src/modules/providers/lexicon-extraction/lexicon-extraction";

import {
  lexiconReviewDimensionValues,
  lexiconReviewOutcomeValues,
  makeCandidateId,
  type LexiconCandidate,
  type LexiconCandidateStatus,
  type LexiconReviewDimension,
} from "../domain/lexicon-candidate";
import type {
  LexiconCandidateApprovalAuditStore,
  LexiconCandidateApprovalRecord,
  LexiconCandidateProvenance,
  LexiconCandidateRepository,
  LexiconCandidateSaveOutcome,
} from "../repositories/lexicon-candidate-repository";
import type { LexiconCorpusRepository } from "../repositories/lexicon-corpus-repository";
import {
  buildCandidateIndexEntry,
  buildCandidateReference,
  indexApprovedCandidate,
  type LexiconCandidateFrozenSource,
} from "./approve-candidate-indexing";
import type { CandidateReviewDecision, CandidateReviewer } from "./candidate-reviewer";
import {
  approveCandidateForIndexing,
  recordCandidateReview,
  submitCandidateForReview,
} from "./lexicon-candidate-review";
import {
  lexiconIndexingIndexes,
  normalizeLexiconIndexingMode,
  type LexiconIndexingMode,
} from "./lexicon-indexing-mode";

/** Bounds provider work when the caller does not set its own bound. */
export const DEFAULT_MAX_CANDIDATES_PER_SEGMENT = 25;

/** Characters of segment text kept on each side of a candidate as context. */
export const CANDIDATE_CONTEXT_WINDOW_CHARS = 120;

/**
 * One frozen segment plus the position it was published at.
 *
 * Both halves come from one object on purpose. The extraction input carries the
 * text and the document key; `paragraphId` / `startMs`–`endMs` are the published
 * position, which the extraction segment does not carry but the corpus reference
 * requires. Splitting them into two arrays would let a caller pair a candidate
 * with another segment's position; keeping them together makes that
 * unrepresentable.
 */
export type LexiconIndexingSegment =
  | (LexiconExtractionSegment & Readonly<{ documentKind: "article"; paragraphId: string }>)
  | (LexiconExtractionSegment & Readonly<{ documentKind: "media"; startMs: number; endMs: number }>);

export type LexiconIndexingPipelineDependencies = Readonly<{
  /** Extraction. Never asked to judge its own proposals. */
  provider: LexemeCandidateProvider;
  /** Independent review port; see `candidate-reviewer.ts`. */
  reviewer: CandidateReviewer;
  /** Candidate rows (idempotent create + CAS save). */
  candidates: LexiconCandidateRepository;
  /** The corpus writer. Touched only through `indexApprovedCandidate()`. */
  corpus: LexiconCorpusRepository;
  /** Required in `index` mode: one audit row per approval (ADR-0011 §5). */
  audits?: LexiconCandidateApprovalAuditStore;
}>;

export type LexiconIndexingRunInput = Readonly<{
  /** Resolved mode, or the raw configured value: anything unknown resolves to `disabled`. */
  mode: LexiconIndexingMode;
  /** One document version per run; every segment must share its document key. */
  segments: readonly LexiconIndexingSegment[];
  /**
   * The owner approval act. Required in `index` mode and validated against the
   * shared review-identity authority. The pipeline never invents one, so
   * extraction can never approve itself.
   */
  approvedBy?: string | null;
  /** Run clock; also the `updatedAt` of every accepted transition. */
  now: Date;
  maxCandidatesPerSegment?: number;
  signal?: AbortSignal;
}>;

export const lexiconIndexingPipelineFailureCodes = [
  /** The run input itself is unusable: bad clock, bad bound, mixed documents. */
  "INDEXING_RUN_INPUT_INVALID",
  /** `index` mode without an owner-authorized approver. */
  "INDEXING_APPROVER_NOT_AUTHORIZED",
  /** `index` mode without an approval-audit store: no approval without its audit. */
  "INDEXING_AUDIT_STORE_MISSING",
  /** Cancelled before or during Phase A; nothing was written. */
  "INDEXING_RUN_CANCELLED",
  /** The provider threw. */
  "INDEXING_EXTRACTION_FAILED",
  /** A proposal cannot become an indexable candidate (or names an unknown segment). */
  "INDEXING_PROPOSAL_INVALID",
  /** The reviewer threw. */
  "INDEXING_REVIEW_FAILED",
  /** The reviewer's verdict is unusable, or contradicts stored review evidence. */
  "INDEXING_REVIEW_INVALID",
  /** The candidate store refused a write, or a concurrent writer won the CAS. */
  "INDEXING_PERSISTENCE_FAILED",
  /** The corpus writer failed or refused. */
  "INDEXING_CORPUS_WRITE_FAILED",
  /** The approval audit could not be appended. */
  "INDEXING_AUDIT_FAILED",
] as const;
export type LexiconIndexingPipelineFailureCode = (typeof lexiconIndexingPipelineFailureCodes)[number];

export type LexiconIndexingCandidateOutcome = Readonly<{
  candidateId: string;
  /** Stored status after this run. */
  status: LexiconCandidateStatus;
  /** Stored revision after this run; the CAS precondition for any retry. */
  revision: number;
  /** `created` when this run inserted the row, `existing` when it was already stored. */
  persistence: "created" | "existing";
  /** True only when *this run* performed the approval act and wrote the corpus. */
  indexed: boolean;
  lexemes: number;
  phrases: number;
}>;

export type LexiconIndexingCounts = Readonly<{
  /** Proposals the provider returned. */
  extracted: number;
  /** Proposals folded onto an identity already planned in this run. */
  deduplicated: number;
  created: number;
  existing: number;
  /** Candidates settled as `rejected` (by this run or already). */
  rejected: number;
  /** Candidates that are `approved` after this run. */
  approved: number;
  /** Candidates this run approved *and* indexed. */
  indexed: number;
  lexemes: number;
  phrases: number;
  /** Reviewer calls made; two per fully reviewed candidate. */
  reviewCalls: number;
}>;

export type LexiconIndexingProviderUsage = Readonly<{
  called: boolean;
  provider: string | null;
  modelVersion: string | null;
  estimatedCostMicros: number | null;
}>;

export type LexiconIndexingPipelineResult =
  | Readonly<{
      ok: true;
      mode: LexiconIndexingMode;
      /** Why no work happened, or `null` when the run did work. */
      skipped: "disabled" | "no-segments" | null;
      candidates: readonly LexiconIndexingCandidateOutcome[];
      counts: LexiconIndexingCounts;
      providerUsage: LexiconIndexingProviderUsage;
    }>
  | Readonly<{
      ok: false;
      mode: LexiconIndexingMode;
      code: LexiconIndexingPipelineFailureCode;
      /** Set when the failure belongs to one candidate. */
      candidateId: string | null;
      detail: string;
    }>;

type LexiconIndexingPipelineFailure = Extract<LexiconIndexingPipelineResult, { ok: false }>;

type FrozenSegment = Readonly<{
  segment: LexiconIndexingSegment;
  frozen: LexiconCandidateFrozenSource;
}>;

type PlannedCandidate = Readonly<{
  /** Freshly extracted snapshot: revision 1, `discovered`. */
  fresh: LexiconCandidate;
  frozen: LexiconCandidateFrozenSource;
  provenance: LexiconCandidateProvenance;
  /** Verdicts from the reviewer, in dimension order. */
  decisions: readonly CandidateReviewDecision[];
}>;

type ApprovalAct = Readonly<{
  approvedBy: string;
  audits: LexiconCandidateApprovalAuditStore;
}>;

const ZERO_COUNTS: LexiconIndexingCounts = {
  extracted: 0,
  deduplicated: 0,
  created: 0,
  existing: 0,
  rejected: 0,
  approved: 0,
  indexed: 0,
  lexemes: 0,
  phrases: 0,
  reviewCalls: 0,
};

const NO_PROVIDER_USAGE: LexiconIndexingProviderUsage = {
  called: false,
  provider: null,
  modelVersion: null,
  estimatedCostMicros: null,
};

function fail(
  mode: LexiconIndexingMode,
  code: LexiconIndexingPipelineFailureCode,
  detail: string,
  candidateId: string | null = null,
): LexiconIndexingPipelineFailure {
  return { ok: false, mode, code, candidateId, detail };
}

function isUsableDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/** Error text for a failure result. Never includes credentials or provider payloads. */
function describeError(error: unknown): string {
  if (error instanceof LexiconExtractionError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Unknown error.";
}

function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true;
  return error instanceof LexiconExtractionError && error.code === "provider-cancelled";
}

/**
 * Context around the surface form, taken from the frozen segment text.
 *
 * The provider contract carries no context field, and re-deriving it from
 * anything but the frozen text would attach a candidate to a passage that was
 * never reviewed. A form the segment does not literally contain yields empty
 * context rather than a guess.
 */
function deriveContext(sourceText: string, surfaceText: string): Readonly<{ before: string; after: string }> {
  const index = sourceText.toLocaleLowerCase("es").indexOf(surfaceText.toLocaleLowerCase("es"));
  if (index < 0) return { before: "", after: "" };
  const end = index + surfaceText.length;
  return {
    before: sourceText.slice(Math.max(0, index - CANDIDATE_CONTEXT_WINDOW_CHARS), index).trim(),
    after: sourceText.slice(end, end + CANDIDATE_CONTEXT_WINDOW_CHARS).trim(),
  };
}

/** Why a proposal cannot become a candidate, or `null` when it can. */
function proposalProblem(proposal: LexiconCandidateProposal): string | null {
  if (proposal.kind !== "lexeme" && proposal.kind !== "phrase") {
    return `Unsupported candidate kind "${String(proposal.kind)}".`;
  }
  if (!proposal.surfaceText.trim() || !proposal.normalizedText.trim()) {
    return "Proposal text is empty; a candidate without text has no identity.";
  }
  if (proposal.partOfSpeech !== null && !isLexiconPartOfSpeech(proposal.partOfSpeech)) {
    return `Part of speech "${proposal.partOfSpeech}" is outside the controlled set.`;
  }
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) {
    return "Proposal confidence is outside [0, 1].";
  }
  return null;
}

/** Assemble the storage-shaped candidate snapshot the reviewer and store receive. */
function assembleCandidate(
  proposal: LexiconCandidateProposal,
  segment: LexiconIndexingSegment,
  now: Date,
): LexiconCandidate {
  const surfaceText = proposal.surfaceText.trim();
  const normalizedText = proposal.normalizedText.trim();
  const context = deriveContext(segment.sourceText, surfaceText);
  return {
    id: makeCandidateId({
      kind: proposal.kind,
      documentKind: segment.documentKind,
      stableKey: segment.documentStableKey,
      version: segment.documentVersion,
      segmentIndex: segment.segmentIndex,
      normalizedText,
    }),
    kind: proposal.kind,
    surfaceText,
    normalizedText,
    lemma: proposal.lemma,
    partOfSpeech: proposal.partOfSpeech,
    meaningZh: proposal.meaningZh,
    status: "discovered",
    revision: 1,
    source: {
      documentKind: segment.documentKind,
      documentStableKey: segment.documentStableKey,
      documentVersion: segment.documentVersion,
      segmentIndex: segment.segmentIndex,
      contextBefore: context.before,
      contextAfter: context.after,
      sourceTitle: segment.sourceTitle,
      sourceKind: segment.sourceKind,
    },
    reviews: [],
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Validate the run's segments and index them by `segmentIndex`.
 *
 * One document per run is not a convenience: proposals only carry a segment
 * index, so a batch spanning two documents could not be attributed to a frozen
 * segment at all. Mixed versions or duplicate indexes are refused before the
 * provider is called, which is also what keeps "approve by source" meaningful.
 */
function planFrozenSegments(
  segments: readonly LexiconIndexingSegment[],
): Readonly<{ ok: true; byIndex: ReadonlyMap<number, FrozenSegment> }> | Readonly<{ ok: false; detail: string }> {
  const byIndex = new Map<number, FrozenSegment>();
  let document: Readonly<{ documentKind: string; documentStableKey: string; documentVersion: number }> | null = null;

  for (const segment of segments) {
    if (!segment.documentStableKey.trim() || !segment.sourceText.trim()) {
      return { ok: false, detail: "A segment is missing its stable key or source text." };
    }
    if (!segment.sourceTitle.trim() || !segment.sourceKind.trim()) {
      return { ok: false, detail: `Segment ${segment.segmentIndex} has no source title or kind.` };
    }
    if (!Number.isInteger(segment.documentVersion) || segment.documentVersion < 1) {
      return { ok: false, detail: `Segment ${segment.segmentIndex} has an invalid document version.` };
    }
    if (!Number.isInteger(segment.segmentIndex) || segment.segmentIndex < 0) {
      return { ok: false, detail: "A segment has an invalid index." };
    }
    if (segment.documentKind === "article") {
      if (!segment.paragraphId.trim()) return { ok: false, detail: `Segment ${segment.segmentIndex} has no paragraph id.` };
    } else {
      if (!Number.isInteger(segment.startMs) || segment.startMs < 0) {
        return { ok: false, detail: `Segment ${segment.segmentIndex} has invalid media timing.` };
      }
      if (!Number.isInteger(segment.endMs) || segment.endMs < segment.startMs) {
        return { ok: false, detail: `Segment ${segment.segmentIndex} has invalid media timing.` };
      }
    }

    if (document === null) {
      document = {
        documentKind: segment.documentKind,
        documentStableKey: segment.documentStableKey,
        documentVersion: segment.documentVersion,
      };
    } else if (
      document.documentKind !== segment.documentKind
      || document.documentStableKey !== segment.documentStableKey
      || document.documentVersion !== segment.documentVersion
    ) {
      return { ok: false, detail: "One run may only cover one document version." };
    }
    if (byIndex.has(segment.segmentIndex)) {
      return { ok: false, detail: `Segment index ${segment.segmentIndex} appears twice in one run.` };
    }

    // Built branch-first so the article/media position stays a discriminated
    // union: a segment cannot end up with media timing and no paragraph id.
    const base = {
      documentStableKey: segment.documentStableKey,
      documentVersion: segment.documentVersion,
      segmentIndex: segment.segmentIndex,
      sourceText: segment.sourceText,
      sourceTitle: segment.sourceTitle,
      sourceKind: segment.sourceKind,
    };
    const frozen: LexiconCandidateFrozenSource = segment.documentKind === "article"
      ? { ...base, documentKind: "article", paragraphId: segment.paragraphId }
      : { ...base, documentKind: "media", startMs: segment.startMs, endMs: segment.endMs };

    byIndex.set(segment.segmentIndex, { segment, frozen });
  }

  return { ok: true, byIndex };
}

/** Why a reviewer's verdict may not be used, or `null` when it may. */
function decisionProblem(decision: CandidateReviewDecision, requested: LexiconReviewDimension): string | null {
  if (decision === null || typeof decision !== "object") return "Reviewer returned no decision.";
  if (decision.dimension !== requested) {
    return `Reviewer answered "${String(decision.dimension)}" for the "${requested}" dimension.`;
  }
  if (!(lexiconReviewOutcomeValues as readonly string[]).includes(decision.outcome)) {
    return `Reviewer returned an unknown outcome "${String(decision.outcome)}".`;
  }
  if (!isOwnerAuthorizedReviewerReference(decision.reviewerReference)) {
    return "Reviewer reference is not owner-authorized.";
  }
  if (!isUsableDate(decision.reviewedAt)) return "Reviewer returned an unusable reviewedAt.";
  return null;
}

type PlannedReview =
  | Readonly<{ ok: true; decisions: readonly CandidateReviewDecision[] }>
  | Readonly<{ ok: false; code: LexiconIndexingPipelineFailureCode; detail: string }>;

/**
 * Which dimensions still need a reviewer call, given the stored row.
 *
 * The verdicts are the expensive part of a run, and a repeat run over the same
 * document version must not pay for them again: a candidate that is already
 * `review_ready`, `approved` or `rejected` has both dimensions on record (or is
 * settled), and a half-reviewed `review_submitted` row only needs the missing
 * one. Reading stored state is safe here because Phase B never trusts it — it
 * re-reads through `create()`/`save()` and decides every transition from the
 * revision the store actually returned.
 */
function dimensionsNeedingReview(stored: LexiconCandidate | null): readonly LexiconReviewDimension[] {
  if (stored === null || stored.status === "discovered") return lexiconReviewDimensionValues;
  if (stored.status === "review_submitted") {
    return lexiconReviewDimensionValues.filter(
      (dimension) => !stored.reviews.some((review) => review.dimension === dimension),
    );
  }
  return [];
}

/**
 * Phase A for one candidate: submit and review, entirely in memory.
 *
 * Nothing here writes, so a verdict that cannot be used, or a reviewer that
 * throws, aborts the run before the first write exists. A `fail` verdict stops
 * the loop: the candidate is already `rejected`, so the second dimension would be
 * paid for and then refused by the state machine.
 */
async function planCandidateReview(
  reviewer: CandidateReviewer,
  fresh: LexiconCandidate,
  dimensions: readonly LexiconReviewDimension[],
  now: Date,
  signal: AbortSignal | undefined,
): Promise<PlannedReview> {
  const submitted = submitCandidateForReview(fresh, { expectedRevision: fresh.revision, now });
  if (!submitted.ok) {
    // Defensive: segment validation already guarantees a frozen source and a
    // revision-1 `discovered` candidate, so this cannot fire today.
    return { ok: false, code: "INDEXING_RUN_INPUT_INVALID", detail: `Candidate "${fresh.id}" cannot be submitted: ${submitted.code}` };
  }

  let current = submitted.candidate;
  const decisions: CandidateReviewDecision[] = [];

  for (const dimension of dimensions) {
    if (signal?.aborted) return { ok: false, code: "INDEXING_RUN_CANCELLED", detail: "Cancelled during review." };

    let decision: CandidateReviewDecision;
    try {
      decision = await reviewer.review(
        { candidate: fresh, dimension },
        signal ? { signal } : undefined,
      );
    } catch (error) {
      if (isCancellation(error, signal)) {
        return { ok: false, code: "INDEXING_RUN_CANCELLED", detail: "Review was cancelled." };
      }
      return { ok: false, code: "INDEXING_REVIEW_FAILED", detail: `${dimension}: ${describeError(error)}` };
    }

    const problem = decisionProblem(decision, dimension);
    if (problem) return { ok: false, code: "INDEXING_REVIEW_INVALID", detail: `${dimension}: ${problem}` };
    decisions.push(decision);

    const recorded = recordCandidateReview(current, {
      dimension: decision.dimension,
      outcome: decision.outcome,
      reviewerReference: decision.reviewerReference,
      reviewedAt: decision.reviewedAt,
      // Diagnosis only: recorded next to the verdict, never consulted when the
      // verdict is applied. See `lexicon-review-reason.ts`.
      reason: decision.reason,
      expectedRevision: current.revision,
      now,
    });
    if (!recorded.ok) {
      return { ok: false, code: "INDEXING_REVIEW_INVALID", detail: `Candidate "${fresh.id}": ${recorded.code}` };
    }
    current = recorded.candidate;
    if (decision.outcome === "fail") break;
  }

  return { ok: true, decisions };
}

type CommitOutcome =
  | Readonly<{ ok: true; outcome: LexiconIndexingCandidateOutcome }>
  | Readonly<{ ok: false; code: LexiconIndexingPipelineFailureCode; candidateId: string; detail: string }>;

function describeFailedSave(outcome: Exclude<LexiconCandidateSaveOutcome, { status: "saved" }>): string {
  if (outcome.status === "conflict") {
    return `CANDIDATE_REVISION_CONFLICT: expected revision ${outcome.expectedRevision}, stored ${outcome.actualRevision}.`;
  }
  if (outcome.status === "not_found") return "CANDIDATE_NOT_FOUND: the row disappeared mid-run.";
  return `${outcome.code}: ${outcome.detail}`;
}

/** One compare-and-swap write; a refusal is a persistence failure, never a retry loop. */
async function saveCandidate(
  dependencies: LexiconIndexingPipelineDependencies,
  candidate: LexiconCandidate,
  expectedRevision: number,
): Promise<Readonly<{ ok: true; candidate: LexiconCandidate }> | Extract<CommitOutcome, { ok: false }>> {
  const saved = await dependencies.candidates.save({ candidate, expectedRevision });
  if (saved.status === "saved") return { ok: true, candidate: saved.record.candidate };
  return {
    ok: false,
    code: "INDEXING_PERSISTENCE_FAILED",
    candidateId: candidate.id,
    detail: describeFailedSave(saved),
  };
}

function approvalAuditRecord(
  candidate: LexiconCandidate,
  approvedBy: string,
  approvedAt: Date,
  counts: Readonly<{ lexemes: number; phrases: number }>,
): LexiconCandidateApprovalRecord {
  return {
    candidateId: candidate.id,
    mode: "single",
    batchId: null,
    approvedBy,
    approvedAt,
    revision: candidate.revision,
    documentKind: candidate.source.documentKind,
    documentStableKey: candidate.source.documentStableKey,
    documentVersion: candidate.source.documentVersion,
    segmentIndex: candidate.source.segmentIndex,
    reviews: candidate.reviews,
    lexemes: counts.lexemes,
    phrases: counts.phrases,
  };
}

/**
 * Phase B for one candidate: insert, rebase, advance, approve, index.
 *
 * The stored row — not the freshly extracted snapshot — is the source of truth
 * from the first write onwards. Each step is one CAS save, so a candidate that is
 * already under review or approved is continued, never reset.
 */
async function commitCandidate(
  dependencies: LexiconIndexingPipelineDependencies,
  approval: ApprovalAct | null,
  plan: PlannedCandidate,
  now: Date,
): Promise<CommitOutcome> {
  const created = await dependencies.candidates.create({ candidate: plan.fresh, provenance: plan.provenance });
  if (created.status === "rejected") {
    return {
      ok: false,
      code: "INDEXING_PERSISTENCE_FAILED",
      candidateId: plan.fresh.id,
      detail: `${created.code}: ${created.detail}`,
    };
  }

  let current = created.record.candidate;

  if (current.status === "discovered") {
    const submitted = submitCandidateForReview(current, { expectedRevision: current.revision, now });
    if (!submitted.ok) {
      return { ok: false, code: "INDEXING_PERSISTENCE_FAILED", candidateId: current.id, detail: submitted.code };
    }
    const saved = await saveCandidate(dependencies, submitted.candidate, current.revision);
    if (!saved.ok) return saved;
    current = saved.candidate;
  }

  for (const decision of plan.decisions) {
    if (current.status !== "review_submitted") break;
    const stored = current.reviews.find((review) => review.dimension === decision.dimension);
    if (stored) {
      // Reviews are append-only audit evidence: a dimension already on record can
      // neither be rewritten nor contradicted. Silently keeping the old verdict
      // would stall the candidate forever, so it is reported instead.
      if (stored.outcome !== decision.outcome) {
        return {
          ok: false,
          code: "INDEXING_REVIEW_INVALID",
          candidateId: current.id,
          detail: `A "${stored.outcome}" verdict for ${decision.dimension} is already on record; a new "${decision.outcome}" verdict cannot be appended.`,
        };
      }
      continue;
    }
    const recorded = recordCandidateReview(current, {
      dimension: decision.dimension,
      outcome: decision.outcome,
      reviewerReference: decision.reviewerReference,
      reviewedAt: decision.reviewedAt,
      // Same annotation as the planning phase: the verdict is `outcome`, and the
      // reason is stored beside it so a rejection can be explained later.
      reason: decision.reason,
      expectedRevision: current.revision,
      now,
    });
    if (!recorded.ok) {
      return { ok: false, code: "INDEXING_PERSISTENCE_FAILED", candidateId: current.id, detail: recorded.code };
    }
    const saved = await saveCandidate(dependencies, recorded.candidate, current.revision);
    if (!saved.ok) return saved;
    current = saved.candidate;
  }

  let indexed = false;
  let lexemes = 0;
  let phrases = 0;

  // The corpus gate. `approval` is non-null only in `index` mode, and the stored
  // status must be `review_ready`: an already-approved candidate is never
  // re-indexed, which is what makes a repeated run idempotent.
  if (approval && current.status === "review_ready") {
    const approved = approveCandidateForIndexing(current, {
      approvedBy: approval.approvedBy,
      expectedRevision: current.revision,
      now,
    });
    if (!approved.ok) {
      return { ok: false, code: "INDEXING_PERSISTENCE_FAILED", candidateId: current.id, detail: approved.code };
    }
    const saved = await saveCandidate(dependencies, approved.candidate, current.revision);
    if (!saved.ok) return saved;
    current = saved.candidate;

    let written: Awaited<ReturnType<typeof indexApprovedCandidate>>;
    try {
      written = await indexApprovedCandidate(dependencies.corpus, { candidate: current, frozen: plan.frozen });
    } catch (error) {
      return {
        ok: false,
        code: "INDEXING_CORPUS_WRITE_FAILED",
        candidateId: current.id,
        detail: describeError(error),
      };
    }
    if (!written.ok) {
      return { ok: false, code: "INDEXING_CORPUS_WRITE_FAILED", candidateId: current.id, detail: written.code };
    }
    lexemes = written.lexemes;
    phrases = written.phrases;
    indexed = true;

    const audit = await approval.audits.insertApprovalAudit(
      approvalAuditRecord(current, approval.approvedBy, now, { lexemes, phrases }),
    );
    if (audit.status === "rejected") {
      return {
        ok: false,
        code: "INDEXING_AUDIT_FAILED",
        candidateId: current.id,
        detail: `${audit.code}: ${audit.detail}`,
      };
    }
  }

  return {
    ok: true,
    outcome: {
      candidateId: current.id,
      status: current.status,
      revision: current.revision,
      persistence: created.status === "created" ? "created" : "existing",
      indexed,
      lexemes,
      phrases,
    },
  };
}

/**
 * Run the chain once for one document version.
 *
 * Never throws for an expected failure: extraction, review, persistence, corpus
 * and audit problems all come back as a typed `ok: false` result carrying one of
 * `lexiconIndexingPipelineFailureCodes`. The one exception is a bug in a caller's
 * dependency implementation, which is allowed to surface as a thrown error rather
 * than be disguised as a result.
 */
export async function runLexiconIndexingPipeline(
  dependencies: LexiconIndexingPipelineDependencies,
  input: LexiconIndexingRunInput,
): Promise<LexiconIndexingPipelineResult> {
  // Fail-closed: re-normalise the mode here so an unvalidated string cannot widen
  // the switch between configuration and execution.
  const mode = normalizeLexiconIndexingMode(input.mode);

  if (mode === "disabled") {
    return {
      ok: true,
      mode,
      skipped: "disabled",
      candidates: [],
      counts: ZERO_COUNTS,
      providerUsage: NO_PROVIDER_USAGE,
    };
  }

  const now = input.now;
  if (!isUsableDate(now)) return fail(mode, "INDEXING_RUN_INPUT_INVALID", "The run clock is missing or invalid.");

  const maxCandidatesPerSegment = input.maxCandidatesPerSegment ?? DEFAULT_MAX_CANDIDATES_PER_SEGMENT;
  if (!Number.isInteger(maxCandidatesPerSegment) || maxCandidatesPerSegment < 1) {
    return fail(mode, "INDEXING_RUN_INPUT_INVALID", "maxCandidatesPerSegment must be a positive integer.");
  }

  // Approval preflight. An approval act is an owner act: it is required in `index`
  // mode, it must pass the shared review-identity authority, and it must have an
  // audit store to land in. All three are checked before anything is read or written.
  let approval: ApprovalAct | null = null;
  if (lexiconIndexingIndexes(mode)) {
    const approvedBy = (input.approvedBy ?? "").trim();
    if (!isOwnerAuthorizedReviewerReference(approvedBy)) {
      return fail(mode, "INDEXING_APPROVER_NOT_AUTHORIZED", "index mode needs an owner-authorized approvedBy.");
    }
    const audits = dependencies.audits;
    if (!audits) {
      return fail(mode, "INDEXING_AUDIT_STORE_MISSING", "index mode needs an approval-audit store.");
    }
    approval = { approvedBy, audits };
  }

  if (!Array.isArray(input.segments)) {
    return fail(mode, "INDEXING_RUN_INPUT_INVALID", "segments must be an array.");
  }
  const planned = planFrozenSegments(input.segments);
  if (!planned.ok) return fail(mode, "INDEXING_RUN_INPUT_INVALID", planned.detail);
  if (planned.byIndex.size === 0) {
    return {
      ok: true,
      mode,
      skipped: "no-segments",
      candidates: [],
      counts: ZERO_COUNTS,
      providerUsage: NO_PROVIDER_USAGE,
    };
  }

  if (input.signal?.aborted) return fail(mode, "INDEXING_RUN_CANCELLED", "Cancelled before extraction.");

  // ---- Phase A: all external calls, no writes ---------------------------------
  let extraction: LexiconExtractionResult;
  try {
    extraction = await dependencies.provider.extractCandidates(
      {
        language: "es",
        segments: input.segments,
        maxCandidatesPerSegment,
      },
      input.signal ? { signal: input.signal } : undefined,
    );
  } catch (error) {
    if (isCancellation(error, input.signal)) {
      return fail(mode, "INDEXING_RUN_CANCELLED", "Extraction was cancelled.");
    }
    return fail(mode, "INDEXING_EXTRACTION_FAILED", describeError(error));
  }

  const plannedCandidates: PlannedCandidate[] = [];
  const seenIds = new Set<string>();
  let deduplicated = 0;
  let reviewCalls = 0;

  for (const proposal of extraction.proposals) {
    if (input.signal?.aborted) return fail(mode, "INDEXING_RUN_CANCELLED", "Cancelled during planning.");

    const frozenSegment = planned.byIndex.get(proposal.segmentIndex);
    if (!frozenSegment) {
      return fail(
        mode,
        "INDEXING_PROPOSAL_INVALID",
        `Proposal references segment ${proposal.segmentIndex}, which is not part of this run.`,
      );
    }
    const problem = proposalProblem(proposal);
    if (problem) return fail(mode, "INDEXING_PROPOSAL_INVALID", problem);

    const fresh = assembleCandidate(proposal, frozenSegment.segment, now);
    // The storage identity is the dedupe key: a surface form repeated inside one
    // segment is one candidate, so it is reviewed and indexed once.
    if (seenIds.has(fresh.id)) {
      deduplicated += 1;
      continue;
    }

    if (approval) {
      // Everything that would make the later corpus write fail is checked here,
      // while nothing has been written: an approval must never exist without a
      // corpus row it can produce.
      if (!buildCandidateIndexEntry(fresh)) {
        return fail(mode, "INDEXING_PROPOSAL_INVALID", `Candidate "${fresh.id}" has no lemma to index.`, fresh.id);
      }
      if (!buildCandidateReference(fresh, frozenSegment.frozen)) {
        return fail(mode, "INDEXING_PROPOSAL_INVALID", `Candidate "${fresh.id}" has no frozen source.`, fresh.id);
      }
    }

    // A read, not a write: it only decides which verdicts still need paying for.
    // `findById` yields the stored row, so the candidate snapshot is what the
    // helper reads — passing the row itself would silently answer "nothing to do".
    const storedRecord = await dependencies.candidates.findById(fresh.id);
    const reviewed = await planCandidateReview(
      dependencies.reviewer,
      fresh,
      dimensionsNeedingReview(storedRecord?.candidate ?? null),
      now,
      input.signal,
    );
    if (!reviewed.ok) return fail(mode, reviewed.code, reviewed.detail, fresh.id);

    seenIds.add(fresh.id);
    reviewCalls += reviewed.decisions.length;
    plannedCandidates.push({
      fresh,
      frozen: frozenSegment.frozen,
      provenance: {
        provider: extraction.provider,
        modelVersion: extraction.modelVersion.trim() ? extraction.modelVersion : null,
        confidence: Math.round(proposal.confidence * 100),
      },
      decisions: reviewed.decisions,
    });
  }

  // ---- Phase B: writes --------------------------------------------------------
  const outcomes: LexiconIndexingCandidateOutcome[] = [];
  let createdCount = 0;
  let existingCount = 0;

  for (const candidatePlan of plannedCandidates) {
    const committed = await commitCandidate(dependencies, approval, candidatePlan, now);
    if (!committed.ok) return fail(mode, committed.code, committed.detail, committed.candidateId);
    outcomes.push(committed.outcome);
    if (committed.outcome.persistence === "created") createdCount += 1;
    else existingCount += 1;
  }

  const counts: LexiconIndexingCounts = {
    extracted: extraction.proposals.length,
    deduplicated,
    created: createdCount,
    existing: existingCount,
    rejected: outcomes.filter((outcome) => outcome.status === "rejected").length,
    approved: outcomes.filter((outcome) => outcome.status === "approved").length,
    indexed: outcomes.filter((outcome) => outcome.indexed).length,
    lexemes: outcomes.reduce((total, outcome) => total + outcome.lexemes, 0),
    phrases: outcomes.reduce((total, outcome) => total + outcome.phrases, 0),
    reviewCalls,
  };

  return {
    ok: true,
    mode,
    skipped: null,
    candidates: outcomes,
    counts,
    providerUsage: {
      called: true,
      provider: extraction.provider,
      modelVersion: extraction.modelVersion,
      estimatedCostMicros: extraction.estimatedCostMicros,
    },
  };
}
