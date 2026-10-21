/**
 * Owner-gated lexicon indexing (LEX-INDEX-001 slice 5).
 *
 * The corpus may only change after an owner approval, and this module is the
 * single place that enforces it: `indexContentVersion()` is called from exactly
 * one function below, after `isIndexable()` has been checked. Everything else in
 * this file either decides whether approval is allowed or records what happened.
 *
 * Persistence boundary: candidates are not stored yet (that is a separate
 * slice), so these functions take an already-loaded `LexiconCandidate` plus the
 * frozen segment it was extracted from, and return the resulting candidate. A
 * repository for candidates can be added later without changing the gate — the
 * `LexiconCorpusRepository` parameter is already the corpus writer interface.
 *
 * Two rules worth stating outright:
 * - an idempotent repeat of an approval must not index twice;
 * - a bulk approval is limited to an explicitly low-risk class, must stay within
 *   one source, and must leave one audit record per candidate (ADR-0011 §5).
 */

import { isOwnerAuthorizedReviewerReference } from "@/src/modules/content-acquisition/domain/review-identity";

import { normalizeSpanishSurface, type ContentReference } from "../domain";
import {
  candidateLemmaStatus,
  isIndexable,
  type LexiconCandidate,
  type LexiconCandidateReview,
} from "../domain/lexicon-candidate";
import type {
  LexemeIndexInput,
  LexiconCorpusRepository,
  PhraseIndexInput,
} from "../repositories/lexicon-corpus-repository";
import { indexContentVersion } from "./index-content-version";
import {
  approveCandidateForIndexing,
  candidateHasBothReviewDimensions,
  type LexiconCandidateReviewFailureCode,
} from "./lexicon-candidate-review";

export type LexiconCandidateIndexFailureCode =
  | LexiconCandidateReviewFailureCode
  /** The candidate is not `approved`; the corpus must stay untouched. */
  | "CANDIDATE_NOT_APPROVED"
  /** The supplied frozen segment is not the one the candidate came from. */
  | "CANDIDATE_SOURCE_MISMATCH"
  /** An approved lexeme candidate carries no lemma, so it cannot be indexed. */
  | "CANDIDATE_INDEX_INPUT_INCOMPLETE"
  /** Bulk approval is restricted to the low-risk class defined by ADR-0011 §5. */
  | "CANDIDATE_BATCH_NOT_ALLOWED";

/**
 * The frozen segment a candidate was extracted from.
 *
 * `contextBefore` / `contextAfter` are deliberately *not* taken from here: they
 * already live on the candidate's extraction-time snapshot, and having one
 * source of truth keeps a caller from pairing a candidate with re-computed
 * context. The position fields are a discriminated union so an article segment
 * cannot be given media timing (or the reverse) by accident.
 */
type LexiconCandidateFrozenSourceBase = Readonly<{
  documentStableKey: string;
  documentVersion: number;
  segmentIndex: number;
  /** Spanish source text of the segment, exactly as it was extracted. */
  sourceText: string;
  sourceTitle: string;
  sourceKind: string;
}>;

export type LexiconCandidateFrozenSource =
  | (LexiconCandidateFrozenSourceBase & Readonly<{ documentKind: "article"; paragraphId: string }>)
  | (LexiconCandidateFrozenSourceBase & Readonly<{ documentKind: "media"; startMs: number; endMs: number }>);

/**
 * Whether the candidate still belongs to the frozen segment in hand.
 *
 * A mismatch means the caller paired a candidate with the wrong text; indexing
 * it would attach an approved surface form to a passage that was never reviewed.
 */
export function candidateMatchesFrozenSource(
  candidate: LexiconCandidate,
  frozen: LexiconCandidateFrozenSource,
): boolean {
  const { source } = candidate;
  return (
    source.documentKind === frozen.documentKind
    && source.documentStableKey === frozen.documentStableKey
    && source.documentVersion === frozen.documentVersion
    && source.segmentIndex === frozen.segmentIndex
    && source.sourceTitle === frozen.sourceTitle
    && source.sourceKind === frozen.sourceKind
  );
}

/** Rebuild the corpus reference for an approved candidate, or `null` on mismatch. */
export function buildCandidateReference(
  candidate: LexiconCandidate,
  frozen: LexiconCandidateFrozenSource,
): ContentReference | null {
  if (!candidateMatchesFrozenSource(candidate, frozen)) return null;
  const document = {
    kind: frozen.documentKind,
    stableKey: frozen.documentStableKey,
    version: frozen.documentVersion,
  };
  const position =
    frozen.documentKind === "article"
      ? { kind: "text" as const, paragraphId: frozen.paragraphId, segmentIndex: frozen.segmentIndex }
      : { kind: "media" as const, startMs: frozen.startMs, endMs: frozen.endMs, segmentIndex: frozen.segmentIndex };
  return {
    document,
    position,
    sourceText: frozen.sourceText,
    contextBefore: candidate.source.contextBefore,
    contextAfter: candidate.source.contextAfter,
  };
}

export type LexiconCandidateIndexEntry =
  | Readonly<{ kind: "lexeme"; lexeme: Omit<LexemeIndexInput, "reference"> }>
  | Readonly<{ kind: "phrase"; phrase: Omit<PhraseIndexInput, "reference"> }>;

/**
 * Translate an approved candidate into the corpus writer's input.
 *
 * Returns `null` when the candidate cannot be indexed honestly: a lexeme without
 * a lemma would force the writer to present a surface form as a lemma, which is
 * a linguistic claim nobody made.
 */
export function buildCandidateIndexEntry(candidate: LexiconCandidate): LexiconCandidateIndexEntry | null {
  if (candidate.kind === "lexeme") {
    const lemma = candidate.lemma?.trim();
    if (!lemma) return null;
    return {
      kind: "lexeme",
      lexeme: {
        lemma,
        normalizedLemma: normalizeSpanishSurface(lemma),
        // Derived, never stored: only an approved candidate reaches this path,
        // which is exactly the "verified only from explicit review" rule.
        lemmaStatus: candidateLemmaStatus(candidate),
        partOfSpeech: candidate.partOfSpeech,
        meaningZh: candidate.meaningZh,
        form: candidate.surfaceText,
        normalizedForm: candidate.normalizedText,
      },
    };
  }
  return {
    kind: "phrase",
    phrase: {
      expression: candidate.surfaceText,
      normalizedExpression: candidate.normalizedText,
      meaningZh: candidate.meaningZh,
      // A pipeline phrase belongs to the shared corpus, never to one user.
      ownerUserId: null,
    },
  };
}

export type LexiconCandidateIndexResult =
  | Readonly<{ ok: true; lexemes: number; phrases: number }>
  | Readonly<{ ok: false; code: LexiconCandidateIndexFailureCode }>;

/**
 * The corpus gate. This is the only call site of `indexContentVersion()`.
 *
 * Every status other than `approved` is refused before any work happens, so
 * `discovered`, `review_submitted`, `review_ready` and `rejected` candidates
 * leave the corpus byte-for-byte unchanged.
 */
export async function indexApprovedCandidate(
  repository: LexiconCorpusRepository,
  input: Readonly<{ candidate: LexiconCandidate; frozen: LexiconCandidateFrozenSource }>,
): Promise<LexiconCandidateIndexResult> {
  const { candidate, frozen } = input;
  if (!isIndexable(candidate)) return { ok: false, code: "CANDIDATE_NOT_APPROVED" };

  const reference = buildCandidateReference(candidate, frozen);
  if (!reference) return { ok: false, code: "CANDIDATE_SOURCE_MISMATCH" };

  const entry = buildCandidateIndexEntry(candidate);
  if (!entry) return { ok: false, code: "CANDIDATE_INDEX_INPUT_INCOMPLETE" };

  const counts = await indexContentVersion(repository, {
    sourceTitle: frozen.sourceTitle,
    sourceKind: frozen.sourceKind,
    segments: [{ text: frozen.sourceText, reference }],
    lexemes: entry.kind === "lexeme" ? [entry.lexeme] : [],
    phrases: entry.kind === "phrase" ? [entry.phrase] : [],
  });
  return { ok: true, lexemes: counts.lexemes, phrases: counts.phrases };
}

/**
 * Per-candidate approval audit. ADR-0011 §5 requires a traceable record for
 * every bulk decision, and this one is self-contained: the two review records
 * are copied verbatim so the audit does not depend on the candidate row.
 */
export type LexiconCandidateApprovalAudit = Readonly<{
  candidateId: string;
  mode: "single" | "batch";
  /** Groups every record produced by one bulk run; `null` for single approvals. */
  batchId: string | null;
  approvedBy: string;
  approvedAt: Date;
  /** Revision created by this approval; the CAS precondition for any retry. */
  revision: number;
  documentKind: "article" | "media";
  documentStableKey: string;
  documentVersion: number;
  segmentIndex: number;
  /** Both review dimensions, copied so dual review is provable from the audit. */
  reviews: readonly LexiconCandidateReview[];
  lexemes: number;
  phrases: number;
}>;

export type LexiconCandidateApprovalOutcome =
  | Readonly<{
      ok: true;
      candidate: LexiconCandidate;
      /** `false` on an idempotent repeat: the corpus is not written a second time. */
      indexed: boolean;
      /** `true` when the candidate was already approved before this call. */
      duplicate: boolean;
      lexemes: number;
      phrases: number;
      audit: LexiconCandidateApprovalAudit | null;
    }>
  | Readonly<{ ok: false; code: LexiconCandidateIndexFailureCode }>;

function approvalAudit(
  candidate: LexiconCandidate,
  input: Readonly<{ approvedBy: string; now: Date; batchId: string | null }>,
  counts: Readonly<{ lexemes: number; phrases: number }>,
): LexiconCandidateApprovalAudit {
  return {
    candidateId: candidate.id,
    mode: input.batchId === null ? "single" : "batch",
    batchId: input.batchId,
    approvedBy: input.approvedBy,
    approvedAt: input.now,
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
 * Approve one reviewed candidate and index it exactly once.
 *
 * Idempotency: passing the already-approved candidate again succeeds, reports
 * `duplicate: true` and leaves the corpus untouched. A caller whose
 * `expectedRevision` disagrees with the snapshot in hand fails the CAS check.
 *
 * Limitation: candidates are not persisted yet, so a caller that retries with
 * the *pre-approval* snapshot is indistinguishable from a first approval. The
 * corpus write itself stays idempotent (`indexLexeme` / `indexPhrase` use
 * `onConflictDoNothing`); a stored candidate revision is what would make the
 * call count idempotent too.
 */
export async function approveCandidateAndIndex(
  repository: LexiconCorpusRepository,
  input: Readonly<{
    candidate: LexiconCandidate;
    frozen: LexiconCandidateFrozenSource;
    approvedBy: string;
    expectedRevision: number;
    now: Date;
    /** Set by bulk approval so every audit record can be grouped. */
    batch?: Readonly<{ batchId: string }>;
  }>,
): Promise<LexiconCandidateApprovalOutcome> {
  // Validate everything that would make the corpus write fail *before*
  // approving, so an approval never exists without its index attempt.
  const reference = buildCandidateReference(input.candidate, input.frozen);
  if (!reference) return { ok: false, code: "CANDIDATE_SOURCE_MISMATCH" };
  if (!buildCandidateIndexEntry(input.candidate)) return { ok: false, code: "CANDIDATE_INDEX_INPUT_INCOMPLETE" };

  const approved = approveCandidateForIndexing(input.candidate, {
    approvedBy: input.approvedBy,
    expectedRevision: input.expectedRevision,
    now: input.now,
  });
  if (!approved.ok) return { ok: false, code: approved.code };

  if (input.candidate.status === "approved") {
    return {
      ok: true,
      candidate: approved.candidate,
      indexed: false,
      duplicate: true,
      lexemes: 0,
      phrases: 0,
      audit: null,
    };
  }

  const indexed = await indexApprovedCandidate(repository, {
    candidate: approved.candidate,
    frozen: input.frozen,
  });
  if (!indexed.ok) return { ok: false, code: indexed.code };

  return {
    ok: true,
    candidate: approved.candidate,
    indexed: true,
    duplicate: false,
    lexemes: indexed.lexemes,
    phrases: indexed.phrases,
    audit: approvalAudit(approved.candidate, {
      approvedBy: input.approvedBy,
      now: input.now,
      batchId: input.batch?.batchId ?? null,
    }, indexed),
  };
}

/**
 * The only class ADR-0011 §5 allows to be approved in bulk.
 *
 * A lexeme whose part of speech the provider never claimed carries no fabricated
 * linguistic fact, so confirming many of them at once cannot launder a claim
 * into the corpus. Anything with a part-of-speech claim — and every phrase, whose
 * `meaningZh` is a translation judgement — must be approved one at a time.
 *
 * `meaningZh` is now checked for lexemes too, not just phrases. Glosses used to
 * be a phrase-only concern, so a lexeme could never carry one; the extraction
 * contract now requires a gloss on every proposal, because the teaching review
 * judges it and the vocabulary view renders it. Without this clause, adding that
 * gloss would have quietly widened what bulk approval is allowed to confirm, and
 * "no translation is ever approved in bulk" would stop being true.
 */
export function isLowRiskBatchApprovableCandidate(candidate: LexiconCandidate): boolean {
  return candidate.kind === "lexeme" && candidate.partOfSpeech === null && candidate.meaningZh === null;
}

export type LexiconCandidateBatchApprovalRequest = Readonly<{
  candidate: LexiconCandidate;
  frozen: LexiconCandidateFrozenSource;
}>;

export type LexiconCandidateBatchViolation = Readonly<{
  candidateId: string;
  code: LexiconCandidateIndexFailureCode;
}>;

export type LexiconCandidateBatchApprovalOutcome =
  | Readonly<{
      ok: true;
      approved: readonly LexiconCandidate[];
      /** One record per approved candidate, all sharing `batchId`. */
      audits: readonly LexiconCandidateApprovalAudit[];
      lexemes: number;
      phrases: number;
    }>
  | Readonly<{
      ok: false;
      code: LexiconCandidateIndexFailureCode;
      /** Every offending candidate, so an operator can fix the whole batch. */
      violations: readonly LexiconCandidateBatchViolation[];
    }>;

/** Why a candidate may not take part in a bulk approval, or `null` when it may. */
function batchApprovalBlocker(
  request: LexiconCandidateBatchApprovalRequest,
  batch: Readonly<{ documentKind: "article" | "media"; documentStableKey: string; documentVersion: number }>,
): LexiconCandidateIndexFailureCode | null {
  const { candidate, frozen } = request;
  if (
    frozen.documentKind !== batch.documentKind
    || frozen.documentStableKey !== batch.documentStableKey
    || frozen.documentVersion !== batch.documentVersion
  ) {
    return "CANDIDATE_SOURCE_MISMATCH";
  }
  if (!candidateMatchesFrozenSource(candidate, frozen)) return "CANDIDATE_SOURCE_MISMATCH";
  if (!isLowRiskBatchApprovableCandidate(candidate)) return "CANDIDATE_BATCH_NOT_ALLOWED";
  if (candidate.status !== "review_ready") return "CANDIDATE_INVALID_TRANSITION";
  if (!candidateHasBothReviewDimensions(candidate)) return "CANDIDATE_REVIEW_INCOMPLETE";
  if (!buildCandidateIndexEntry(candidate)) return "CANDIDATE_INDEX_INPUT_INCOMPLETE";
  return null;
}

/**
 * Bulk approval for one source, restricted to the low-risk class.
 *
 * The whole batch is validated before anything is approved, so a bad member
 * cannot leave a half-applied batch behind (`AGENTS.md` §8: no partial
 * publication). Each approved candidate is still indexed individually and gets
 * its own audit record — batch approval is a review-effort shortcut, never a
 * shortcut around dual review or around the approval gate.
 *
 * An empty batch is a no-op: it cannot violate any invariant.
 */
export async function approveCandidateBatch(
  repository: LexiconCorpusRepository,
  input: Readonly<{
    /** One source per batch; ADR-0011 §5 approves "by source". */
    documentKind: "article" | "media";
    documentStableKey: string;
    documentVersion: number;
    requests: readonly LexiconCandidateBatchApprovalRequest[];
    approvedBy: string;
    now: Date;
    batchId: string;
  }>,
): Promise<LexiconCandidateBatchApprovalOutcome> {
  if (!isOwnerAuthorizedReviewerReference(input.approvedBy)) {
    return {
      ok: false,
      code: "CANDIDATE_REVIEWER_NOT_AUTHORIZED",
      violations: input.requests.map((request) => ({
        candidateId: request.candidate.id,
        code: "CANDIDATE_REVIEWER_NOT_AUTHORIZED" as const,
      })),
    };
  }

  const violations = input.requests.flatMap((request) => {
    const code = batchApprovalBlocker(request, input);
    return code ? [{ candidateId: request.candidate.id, code }] : [];
  });
  const firstViolation = violations[0];
  if (firstViolation) {
    return { ok: false, code: firstViolation.code, violations };
  }

  const approved: LexiconCandidate[] = [];
  const audits: LexiconCandidateApprovalAudit[] = [];
  let lexemes = 0;
  let phrases = 0;
  for (const request of input.requests) {
    const outcome = await approveCandidateAndIndex(repository, {
      candidate: request.candidate,
      frozen: request.frozen,
      approvedBy: input.approvedBy,
      expectedRevision: request.candidate.revision,
      now: input.now,
      batch: { batchId: input.batchId },
    });
    if (!outcome.ok) {
      return { ok: false, code: outcome.code, violations: [{ candidateId: request.candidate.id, code: outcome.code }] };
    }
    approved.push(outcome.candidate);
    if (outcome.audit) audits.push(outcome.audit);
    lexemes += outcome.lexemes;
    phrases += outcome.phrases;
  }
  return { ok: true, approved, audits, lexemes, phrases };
}
