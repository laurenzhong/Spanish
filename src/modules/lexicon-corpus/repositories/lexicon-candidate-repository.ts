/**
 * Lexicon candidate persistence contract (LEX-INDEX-001 slice 6 prerequisite).
 *
 * The contract is split into two interfaces on purpose:
 *
 * - {@link LexiconCandidateRepository} — the candidate rows and the frozen
 *   source snapshot they were extracted from. Every write is a compare-and-swap
 *   on `revision`: a caller carrying a stale snapshot receives a conflict and the
 *   newer stored state is left byte-for-byte untouched. There is no
 *   last-write-wins path in this contract, because a lost update here would move
 *   an approved candidate onto state nobody reviewed.
 * - {@link LexiconCandidateApprovalAuditStore} — the append-only approval trail.
 *   One record per candidate decision, never rewritten, so ADR-0011 §5's "one
 *   audit record per candidate" still holds when a whole batch is approved at
 *   once.
 *
 * They are separate because their storage shapes differ: the candidate rows map
 * onto the committed `lexicon_candidates` table, while the approval audit
 * (`mode`, `batchId`, per-decision corpus counts) has **no column in that
 * table**. One merged interface would force the Postgres implementation to
 * either throw from a method or silently drop audit evidence; see
 * `drizzle-lexicon-candidate-repository.ts` for exactly what is and is not
 * implemented against the current schema.
 *
 * ## Identity
 *
 * A stored candidate is identified by the same six columns as the table's
 * `lexicon_candidates_identity_uidx`: kind, document kind, stable key, document
 * version, segment index and normalized text. Re-extraction of the same span
 * therefore lands on the same identity instead of creating a second row.
 *
 * `LexiconCandidate.id` is *derived* from those fields by `makeCandidateId()`
 * and is what callers pass to {@link LexiconCandidateRepository.findById}. The
 * Postgres primary key is a surrogate uuid and cannot store the derived id, so
 * every implementation reproduces the id from the identity columns rather than
 * inventing one. A candidate whose `id` disagrees with its own fields is refused
 * with `CANDIDATE_IDENTITY_MISMATCH` instead of being silently re-keyed.
 *
 * Inherited limitation (not introduced here): `makeCandidateId()` does not
 * encode `documentKind`, while the table's unique index does. Two documents of
 * different kinds sharing one stable key would therefore collapse onto one
 * derived id. Stable keys are namespaced by kind in this codebase
 * (`article.*` for articles, `podcast.*` / `youtube.*` / `media.*` for media),
 * so the collision is not reachable today; an id-only lookup that does hit it is
 * refused loudly through {@link LexiconCandidateIdentityAmbiguousError} rather
 * than answering with an arbitrary row.
 */

import {
  makeCandidateId,
  type LexiconCandidate,
  type LexiconCandidateKind,
  type LexiconCandidateReview,
} from "../domain/lexicon-candidate";

/** Document kind a candidate was extracted from. Mirrors the table's check constraint. */
export type LexiconDocumentKind = LexiconCandidate["source"]["documentKind"];

/**
 * Extraction-time provenance.
 *
 * The domain model deliberately does not carry the provider identity: it is an
 * ingestion fact, not a learning fact. It is still persisted per candidate
 * (`AGENTS.md` §7: record provider, model version and confidence).
 */
export type LexiconCandidateProvenance = Readonly<{
  /** Internal provider key, e.g. `fake` or `minimax`. */
  provider: string;
  modelVersion: string | null;
  /** Provider confidence as a whole percent (0–100); the column is an integer. */
  confidence: number | null;
}>;

/** One stored candidate: the domain candidate plus the ingestion provenance. */
export type LexiconCandidateRecord = Readonly<{
  candidate: LexiconCandidate;
  provenance: LexiconCandidateProvenance;
}>;

/** One published document version. Candidates are approved "by source" (ADR-0011 §5). */
export type LexiconCandidateSourceKey = Readonly<{
  documentKind: LexiconDocumentKind;
  documentStableKey: string;
  documentVersion: number;
}>;

/**
 * Why a write was refused before it could touch stored state.
 *
 * Every code is reachable — a code that cannot happen would invite callers to
 * handle a case that does not exist.
 */
export type LexiconCandidateWriteRejectionCode =
  /** `candidate.id` is not `makeCandidateId()` over the candidate's own fields. */
  | "CANDIDATE_IDENTITY_MISMATCH"
  /**
   * The revision contract was broken: on creation the revision is not an integer
   * >= 1, or on a CAS write it does not advance exactly one step past
   * `expectedRevision`. Both would make the stored revision a lying CAS
   * precondition.
   */
  | "CANDIDATE_REVISION_INVALID"
  /** An `approved` candidate carries no `approvedBy`/`approvedAt` audit pair. */
  | "CANDIDATE_APPROVAL_AUDIT_MISSING"
  /** Provenance is not storable: a non-integer or out-of-range confidence. */
  | "CANDIDATE_PROVENANCE_INVALID";

export type LexiconCandidateWriteRejection = Readonly<{
  status: "rejected";
  code: LexiconCandidateWriteRejectionCode;
  candidateId: string;
  detail: string;
}>;

export type LexiconCandidateCreateOutcome =
  | Readonly<{ status: "created"; record: LexiconCandidateRecord }>
  /** The identity is already stored; the existing row is returned and never overwritten. */
  | Readonly<{ status: "exists"; record: LexiconCandidateRecord }>
  | LexiconCandidateWriteRejection;

/**
 * Outcome of a compare-and-swap write.
 *
 * `conflict` is the load-bearing case: the stored revision differs from
 * `expectedRevision`, so **nothing was written** and `current` is the state the
 * caller must rebase onto. `not_found` means there is no row for this identity —
 * use {@link LexiconCandidateRepository.create} first.
 */
export type LexiconCandidateSaveOutcome =
  | Readonly<{ status: "saved"; record: LexiconCandidateRecord }>
  | Readonly<{ status: "not_found"; candidateId: string }>
  | Readonly<{
      status: "conflict";
      candidateId: string;
      expectedRevision: number;
      /** Revision actually stored; the winner that was not overwritten. */
      actualRevision: number;
      /** The stored state in full, so a retry can be built from real data. */
      current: LexiconCandidateRecord;
    }>
  | LexiconCandidateWriteRejection;

/** Raised when an id-only lookup matches more than one stored identity. */
export class LexiconCandidateIdentityAmbiguousError extends Error {
  readonly code = "CANDIDATE_IDENTITY_AMBIGUOUS" as const;
  readonly candidateId: string;

  constructor(candidateId: string) {
    super(
      `Candidate id "${candidateId}" matches more than one stored identity. `
        + "Pass a full candidate (with its document kind) instead of an id-only lookup.",
    );
    this.name = "LexiconCandidateIdentityAmbiguousError";
    this.candidateId = candidateId;
  }
}

/** The six columns the table's unique identity index is built from. */
export function candidateStorageIdentity(candidate: LexiconCandidate): Readonly<{
  kind: LexiconCandidateKind;
  documentKind: LexiconDocumentKind;
  documentStableKey: string;
  documentVersion: number;
  segmentIndex: number;
  normalizedText: string;
}> {
  return {
    kind: candidate.kind,
    documentKind: candidate.source.documentKind,
    documentStableKey: candidate.source.documentStableKey,
    documentVersion: candidate.source.documentVersion,
    segmentIndex: candidate.source.segmentIndex,
    normalizedText: candidate.normalizedText,
  };
}

/**
 * `makeCandidateId()` over a candidate's own fields: the id a faithful store
 * must be able to hand back.
 */
export function derivedCandidateId(candidate: LexiconCandidate): string {
  return makeCandidateId({
    kind: candidate.kind,
    documentKind: candidate.source.documentKind,
    stableKey: candidate.source.documentStableKey,
    version: candidate.source.documentVersion,
    segmentIndex: candidate.source.segmentIndex,
    normalizedText: candidate.normalizedText,
  });
}

function reject(
  candidateId: string,
  code: LexiconCandidateWriteRejectionCode,
  detail: string,
): LexiconCandidateWriteRejection {
  return { status: "rejected", code, candidateId, detail };
}

/**
 * The derived-identity rule on its own.
 *
 * Checked *before* any storage lookup so a caller that mislabels a candidate is
 * told so, instead of getting a `not_found` that hides the real mistake.
 */
export function validateCandidateIdentity(candidate: LexiconCandidate): LexiconCandidateWriteRejection | null {
  const derived = derivedCandidateId(candidate);
  return candidate.id === derived
    ? null
    : reject(
        candidate.id,
        "CANDIDATE_IDENTITY_MISMATCH",
        `Candidate id must be makeCandidateId() over its own fields (expected "${derived}").`,
      );
}

/**
 * Checks that do not depend on stored state: the derived identity, the
 * provenance range the column allows, and the approval audit pair that
 * `lexicon_candidates_approved_audit_check` requires.
 *
 * Shared by every implementation on purpose: a validator that lives only in the
 * in-memory store would let a test pass on a record Postgres rejects, which is
 * exactly the kind of green that hides a defect. Postgres still enforces the
 * same rules with real check constraints; this makes the failure a typed result
 * instead of a driver error.
 */
export function validateCandidateWriteShape(record: LexiconCandidateRecord): LexiconCandidateWriteRejection | null {
  const { candidate, provenance } = record;
  const identityFailure = validateCandidateIdentity(candidate);
  if (identityFailure) return identityFailure;
  if (
    provenance.confidence !== null
    && (!Number.isInteger(provenance.confidence) || provenance.confidence < 0 || provenance.confidence > 100)
  ) {
    return reject(
      candidate.id,
      "CANDIDATE_PROVENANCE_INVALID",
      "Confidence is stored as a whole percent between 0 and 100.",
    );
  }
  // Without the audit pair the corpus would receive a `verified` lemma that no
  // recorded decision supports.
  if (candidate.status === "approved" && (candidate.approvedBy === null || candidate.approvedAt === null)) {
    return reject(
      candidate.id,
      "CANDIDATE_APPROVAL_AUDIT_MISSING",
      "An approved candidate must carry approvedBy and approvedAt.",
    );
  }
  return null;
}

/**
 * The revision contract.
 *
 * `expectedRevision === null` means creation: the candidate must start at an
 * integer revision >= 1. Otherwise the write must advance exactly one step,
 * because a stored revision that jumps by more than the state machine allows
 * stops being a truthful CAS precondition.
 */
export function validateCandidateRevision(
  candidate: LexiconCandidate,
  expectedRevision: number | null,
): LexiconCandidateWriteRejection | null {
  if (expectedRevision === null) {
    return Number.isInteger(candidate.revision) && candidate.revision >= 1
      ? null
      : reject(candidate.id, "CANDIDATE_REVISION_INVALID", "A stored revision must be an integer >= 1.");
  }
  return candidate.revision === expectedRevision + 1
    ? null
    : reject(
        candidate.id,
        "CANDIDATE_REVISION_INVALID",
        `A write must advance exactly one revision (got ${candidate.revision}, expected ${expectedRevision + 1}).`,
      );
}

export interface LexiconCandidateRepository {
  /**
   * Insert a candidate that has no stored row yet.
   *
   * Idempotent on the storage identity: a repeat extraction returns
   * `status: "exists"` with the stored record, so an already reviewed or
   * approved candidate is never reset back to `discovered`.
   */
  create(record: LexiconCandidateRecord): Promise<LexiconCandidateCreateOutcome>;

  /**
   * Read one candidate by its derived id.
   *
   * Returns `null` when nothing is stored. Throws
   * {@link LexiconCandidateIdentityAmbiguousError} when the id matches more than
   * one document kind (see the file header) — an ambiguous lookup must not be
   * answered with an arbitrary row.
   */
  findById(id: string): Promise<LexiconCandidateRecord | null>;

  /**
   * Compare-and-swap write of an existing candidate.
   *
   * Accepted only when `expectedRevision` equals the stored revision *and* the
   * candidate advances exactly one revision. Otherwise the stored state is left
   * untouched and the caller gets `conflict` (stale snapshot) or `not_found`.
   */
  save(input: Readonly<{
    candidate: LexiconCandidate;
    /** Revision the caller read; the CAS precondition. */
    expectedRevision: number;
    /** Omit to keep the stored provenance unchanged. */
    provenance?: LexiconCandidateProvenance;
  }>): Promise<LexiconCandidateSaveOutcome>;

  /**
   * Every candidate of one document version, whatever its status, ordered by
   * `segmentIndex` then derived id. This is the input of "approve by source".
   */
  listBySource(source: LexiconCandidateSourceKey): Promise<readonly LexiconCandidateRecord[]>;

  /**
   * The candidates of one document version that may be handed to
   * `indexApprovedCandidate()`: only `approved` rows, and only rows that carry
   * the approval audit pair.
   *
   * Nothing else is ever returned. A `discovered`, `review_submitted`,
   * `review_ready` or `rejected` candidate has no path into this result — that is
   * the persistence half of the corpus gate.
   */
  listIndexable(source: LexiconCandidateSourceKey): Promise<readonly LexiconCandidateRecord[]>;
}

/**
 * One approval decision, copied out of the candidate row so the trail does not
 * depend on it (`ADR-0011` §5). Field-for-field compatible with the application
 * layer's `LexiconCandidateApprovalAudit`, which is what actually produces these
 * records.
 */
export type LexiconCandidateApprovalRecord = Readonly<{
  candidateId: string;
  mode: "single" | "batch";
  /** Groups every record produced by one bulk run; `null` for a single approval. */
  batchId: string | null;
  approvedBy: string;
  approvedAt: Date;
  /** Revision created by this approval: the CAS precondition for any retry. */
  revision: number;
  documentKind: LexiconDocumentKind;
  documentStableKey: string;
  documentVersion: number;
  segmentIndex: number;
  /** Both review dimensions, copied so dual review is provable from the audit alone. */
  reviews: readonly LexiconCandidateReview[];
  lexemes: number;
  phrases: number;
}>;

/** Why an audit append was refused before it could write anything. */
export type LexiconCandidateAuditRejectionCode =
  /** The same candidate revision appears twice in one call; the batch is malformed. */
  | "CANDIDATE_AUDIT_DUPLICATE_IN_CALL"
  /** A batch write contained records that do not share one non-null `batchId`. */
  | "CANDIDATE_AUDIT_BATCH_ID_INCONSISTENT"
  /** `mode` disagrees with `batchId`: `batch` needs one, `single` must not carry one. */
  | "CANDIDATE_AUDIT_MODE_INCONSISTENT";

export type LexiconCandidateAuditWriteOutcome =
  | Readonly<{
      status: "recorded";
      /** Records newly appended by this call. */
      inserted: number;
      /** Records already stored for the same `(candidateId, revision)`; kept, not duplicated. */
      duplicates: number;
    }>
  | Readonly<{
      status: "rejected";
      code: LexiconCandidateAuditRejectionCode;
      detail: string;
    }>;

export type LexiconCandidateAuditQuery = Readonly<{
  candidateId?: string;
  batchId?: string;
}>;

export interface LexiconCandidateApprovalAuditStore {
  /**
   * Append one approval decision.
   *
   * Repeating the same `(candidateId, revision)` is a no-op that reports
   * `duplicates: 1`: a retried approval must not accumulate a second audit row.
   */
  insertApprovalAudit(record: LexiconCandidateApprovalRecord): Promise<LexiconCandidateAuditWriteOutcome>;

  /**
   * Append a whole bulk run in one step.
   *
   * All-or-nothing: the batch is validated first, so a malformed member leaves
   * no partial trail (`AGENTS.md` §8: no partial publication). Exactly one
   * record per candidate is written; `inserted` equals the number of candidates
   * that were not already on record.
   */
  insertApprovalAudits(records: readonly LexiconCandidateApprovalRecord[]): Promise<LexiconCandidateAuditWriteOutcome>;

  /** Approval records matching the query, ordered by `approvedAt` then candidate id. */
  listApprovalAudits(query: LexiconCandidateAuditQuery): Promise<readonly LexiconCandidateApprovalRecord[]>;
}
