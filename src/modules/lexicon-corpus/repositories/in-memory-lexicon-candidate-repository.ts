/**
 * In-memory lexicon candidate store (LEX-INDEX-001 slice 6 prerequisite).
 *
 * This is the implementation the application layer can be developed and tested
 * against today: the `lexicon_candidates` migration exists but is deliberately
 * **not applied**, so the Postgres implementation is code-only for now
 * (see `drizzle-lexicon-candidate-repository.ts`).
 *
 * The store mirrors the committed table rather than "whatever is convenient":
 *
 * - rows are keyed by the same six columns as
 *   `lexicon_candidates_identity_uidx`, so a re-extraction of the same span is a
 *   duplicate instead of a second row;
 * - `save()` is a compare-and-swap on `revision`. A write whose `expectedRevision`
 *   no longer matches the stored revision returns `conflict` together with the
 *   stored state and **does not touch** that state;
 * - stored records are deep-copied in and out, so a caller mutating the object it
 *   passed can never rewrite stored state behind the CAS;
 * - the same invariants the database enforces are checked before anything is
 *   written (identity, revision progression, approval audit pair, confidence
 *   range), so a test that passes here is not passing because the fake is more
 *   permissive than Postgres.
 *
 * Approval audits live in a second map keyed by `(candidateId, revision)`: one
 * record per decision, and a retried approval adds nothing.
 */

import type { LexiconCandidate, LexiconCandidateReview } from "../domain/lexicon-candidate";
import {
  LexiconCandidateIdentityAmbiguousError,
  derivedCandidateId,
  validateCandidateIdentity,
  validateCandidateRevision,
  validateCandidateWriteShape,
  type LexiconCandidateApprovalAuditStore,
  type LexiconCandidateApprovalRecord,
  type LexiconCandidateAuditQuery,
  type LexiconCandidateAuditWriteOutcome,
  type LexiconCandidateCreateOutcome,
  type LexiconCandidateProvenance,
  type LexiconCandidateRecord,
  type LexiconCandidateRepository,
  type LexiconCandidateSaveOutcome,
  type LexiconCandidateSourceKey,
  type LexiconCandidateWriteRejection,
} from "./lexicon-candidate-repository";

/**
 * The six identity columns, as one unambiguous map key. `JSON.stringify` is used
 * instead of a separator join so a stable key or surface form containing the
 * separator cannot make two identities collide.
 */
function storageKey(candidate: LexiconCandidate): string {
  return JSON.stringify([
    candidate.kind,
    candidate.source.documentKind,
    candidate.source.documentStableKey,
    candidate.source.documentVersion,
    candidate.source.segmentIndex,
    candidate.normalizedText,
  ]);
}

function auditKey(record: LexiconCandidateApprovalRecord): string {
  return JSON.stringify([record.candidateId, record.revision]);
}

function cloneProvenance(provenance: LexiconCandidateProvenance): LexiconCandidateProvenance {
  return { provider: provenance.provider, modelVersion: provenance.modelVersion, confidence: provenance.confidence };
}

/**
 * Copy one review for storage in the fake.
 *
 * `reason` is copied only when present, so a review without one keeps the same
 * four-key shape the database writes for historical rows. The verdict is copied
 * verbatim, and the reason is never inspected — same rule as the jsonb codec.
 */
function cloneReview(review: LexiconCandidateReview): LexiconCandidateReview {
  const copy: LexiconCandidateReview = {
    dimension: review.dimension,
    outcome: review.outcome,
    reviewerReference: review.reviewerReference,
    reviewedAt: new Date(review.reviewedAt.getTime()),
  };
  return review.reason === undefined ? copy : { ...copy, reason: review.reason };
}

function cloneRecord(record: LexiconCandidateRecord): LexiconCandidateRecord {
  const { candidate } = record;
  return {
    candidate: {
      ...candidate,
      source: { ...candidate.source },
      reviews: candidate.reviews.map(cloneReview),
      approvedAt: candidate.approvedAt ? new Date(candidate.approvedAt.getTime()) : null,
      createdAt: new Date(candidate.createdAt.getTime()),
      updatedAt: new Date(candidate.updatedAt.getTime()),
    },
    provenance: cloneProvenance(record.provenance),
  };
}

function cloneAudit(record: LexiconCandidateApprovalRecord): LexiconCandidateApprovalRecord {
  return {
    ...record,
    approvedAt: new Date(record.approvedAt.getTime()),
    reviews: record.reviews.map(cloneReview),
  };
}

/**
 * Everything the table would refuse, in the order the write path checks it:
 * caller-independent shape first, then the revision contract. The rules
 * themselves live in the contract module so both implementations accept exactly
 * the same records.
 */
function validateWrite(
  record: LexiconCandidateRecord,
  expectedRevision: number | null,
): LexiconCandidateWriteRejection | null {
  return validateCandidateWriteShape(record) ?? validateCandidateRevision(record.candidate, expectedRevision);
}

function matchesSource(candidate: LexiconCandidate, source: LexiconCandidateSourceKey): boolean {
  return (
    candidate.source.documentKind === source.documentKind
    && candidate.source.documentStableKey === source.documentStableKey
    && candidate.source.documentVersion === source.documentVersion
  );
}

/** Segment order, then derived id: the stable order a bulk approval can rely on. */
function bySourceOrder(left: LexiconCandidateRecord, right: LexiconCandidateRecord): number {
  return (
    left.candidate.source.segmentIndex - right.candidate.source.segmentIndex
    || derivedCandidateId(left.candidate).localeCompare(derivedCandidateId(right.candidate), "es")
  );
}

function validateAuditMode(record: LexiconCandidateApprovalRecord): LexiconCandidateAuditWriteOutcome | null {
  const consistent = record.mode === "batch" ? record.batchId !== null : record.batchId === null;
  return consistent
    ? null
    : {
        status: "rejected",
        code: "CANDIDATE_AUDIT_MODE_INCONSISTENT",
        detail: `A "${record.mode}" approval record must ${record.mode === "batch" ? "carry" : "not carry"} a batchId.`,
      };
}

export type InMemoryLexiconCandidateRepository =
  & LexiconCandidateRepository
  & LexiconCandidateApprovalAuditStore;

/**
 * Build an empty in-memory store. Tests populate it through `create()`/`save()`
 * so every stored record passed the same validation a real write would.
 */
export function createInMemoryLexiconCandidateRepository(): InMemoryLexiconCandidateRepository {
  const records = new Map<string, LexiconCandidateRecord>();
  /** Derived id -> storage keys. More than one key means the id is ambiguous. */
  const keysByDerivedId = new Map<string, string[]>();
  const audits = new Map<string, LexiconCandidateApprovalRecord>();

  function findById(id: string): LexiconCandidateRecord | null {
    const keys = keysByDerivedId.get(id) ?? [];
    if (keys.length === 0) return null;
    if (keys.length > 1) throw new LexiconCandidateIdentityAmbiguousError(id);
    const stored = records.get(keys[0]!);
    return stored ? cloneRecord(stored) : null;
  }

  function insertApprovalAudits(recordsToInsert: readonly LexiconCandidateApprovalRecord[]): LexiconCandidateAuditWriteOutcome {
    if (recordsToInsert.length === 0) return { status: "recorded", inserted: 0, duplicates: 0 };

    // Validate the whole batch before writing a single record, so a malformed
    // member cannot leave a partial audit trail behind.
    const seen = new Set<string>();
    const batchIds = new Set<string>();
    for (const record of recordsToInsert) {
      const modeFailure = validateAuditMode(record);
      if (modeFailure) return modeFailure;
      if (record.batchId !== null) batchIds.add(record.batchId);
      const key = auditKey(record);
      if (seen.has(key)) {
        return {
          status: "rejected",
          code: "CANDIDATE_AUDIT_DUPLICATE_IN_CALL",
          detail: `Candidate "${record.candidateId}" revision ${record.revision} appears twice in one batch.`,
        };
      }
      seen.add(key);
    }
    if (recordsToInsert.length > 1 && (recordsToInsert.some((record) => record.mode === "single") || batchIds.size !== 1 || batchIds.has(""))) {
      return {
        status: "rejected",
        code: "CANDIDATE_AUDIT_BATCH_ID_INCONSISTENT",
        detail: "Every record of one bulk run must share the same non-null batchId.",
      };
    }

    let inserted = 0;
    let duplicates = 0;
    for (const record of recordsToInsert) {
      const key = auditKey(record);
      if (audits.has(key)) {
        // Already on record: keep the first trail entry and report the no-op.
        duplicates += 1;
        continue;
      }
      audits.set(key, cloneAudit(record));
      inserted += 1;
    }
    return { status: "recorded", inserted, duplicates };
  }

  return {
    async create(record): Promise<LexiconCandidateCreateOutcome> {
      const failure = validateWrite(record, null);
      if (failure) return failure;

      const key = storageKey(record.candidate);
      const existing = records.get(key);
      // `onConflictDoNothing` + read-back: a repeat extraction must never reset
      // a candidate that is already under review or approved.
      if (existing) return { status: "exists", record: cloneRecord(existing) };

      records.set(key, cloneRecord(record));
      const derived = derivedCandidateId(record.candidate);
      keysByDerivedId.set(derived, [...(keysByDerivedId.get(derived) ?? []), key]);
      return { status: "created", record: cloneRecord(record) };
    },

    async findById(id) {
      return findById(id);
    },

    async save(input): Promise<LexiconCandidateSaveOutcome> {
      // Identity is a caller bug that no stored state can make valid, so it is
      // answered first; everything else is decided against real stored state.
      const identityFailure = validateCandidateIdentity(input.candidate);
      if (identityFailure) return identityFailure;

      const key = storageKey(input.candidate);
      const stored = records.get(key);
      if (!stored) return { status: "not_found", candidateId: input.candidate.id };

      // State first: a stale caller must learn that newer state exists, not that
      // its own snapshot is malformed.
      if (stored.candidate.revision !== input.expectedRevision) {
        return {
          status: "conflict",
          candidateId: input.candidate.id,
          expectedRevision: input.expectedRevision,
          actualRevision: stored.candidate.revision,
          current: cloneRecord(stored),
        };
      }

      const provenance = input.provenance ?? stored.provenance;
      const failure = validateWrite(
        { candidate: input.candidate, provenance },
        // The CAS matched above, so this can only fail on a caller bug: a
        // transition that does not advance exactly one revision.
        input.expectedRevision,
      );
      if (failure) return failure;

      records.set(key, cloneRecord({ candidate: input.candidate, provenance }));
      return {
        status: "saved",
        record: cloneRecord({ candidate: input.candidate, provenance }),
      };
    },

    async listBySource(source) {
      return [...records.values()]
        .filter((record) => matchesSource(record.candidate, source))
        .sort(bySourceOrder)
        .map(cloneRecord);
    },

    async listIndexable(source) {
      return [...records.values()]
        .filter((record) =>
          matchesSource(record.candidate, source)
          && record.candidate.status === "approved"
          // Defence in depth for the table's approved-audit check: even a row
          // that somehow claims `approved` without a recorded approver is not
          // offered to the corpus gate.
          && record.candidate.approvedBy !== null
          && record.candidate.approvedAt !== null)
        .sort(bySourceOrder)
        .map(cloneRecord);
    },

    async insertApprovalAudit(record) {
      return insertApprovalAudits([record]);
    },

    async insertApprovalAudits(recordsToInsert) {
      return insertApprovalAudits(recordsToInsert);
    },

    async listApprovalAudits(query: LexiconCandidateAuditQuery) {
      return [...audits.values()]
        .filter((record) =>
          (query.candidateId === undefined || record.candidateId === query.candidateId)
          && (query.batchId === undefined || record.batchId === query.batchId))
        .sort((left, right) =>
          left.approvedAt.getTime() - right.approvedAt.getTime()
          || left.candidateId.localeCompare(right.candidateId, "es")
          || left.revision - right.revision)
        .map(cloneAudit);
    },
  };
}
