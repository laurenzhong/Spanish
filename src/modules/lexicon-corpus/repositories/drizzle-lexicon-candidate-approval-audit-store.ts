/**
 * Postgres approval-audit store (LEX-INDEX-001).
 *
 * Implements `LexiconCandidateApprovalAuditStore` against
 * `lexicon_candidate_approvals`, the child table migration `0042` created and the
 * migration that was applied to the target database.
 *
 * ## Why this is a child table at all
 *
 * `lexicon_candidates` has no column for `mode`, `batchId`, `lexemes` or
 * `phrases`, so an approval audit written into that row would have to either
 * throw or silently drop the batch correlation — and a batch approval's only
 * traceable record is exactly that correlation (ADR-0011 §5). The audit
 * therefore lives in its own append-only table, one row per
 * `(candidate_id, revision)`, enforced by
 * `lexicon_candidate_approvals_candidate_revision_uidx`.
 *
 * ## Semantics, mirrored from the in-memory store
 *
 * `insertApprovalAudits()` is the same contract as
 * `in-memory-lexicon-candidate-repository.ts`, so a test that passes against
 * the fake cannot pass for a different reason than production:
 *
 * - **duplicate `(candidateId, revision)` is reported, never repeated.** The
 *   insert uses `on conflict (candidate_id, revision) do nothing`, so a retried
 *   approval returns `{ inserted: 0, duplicates: 1 }` and the first trail entry
 *   is left untouched — not overwritten, and not duplicated;
 * - **a batch is all-or-nothing.** Every member is validated before the
 *   transaction opens, and every insert runs inside one transaction, so a
 *   member that fails mid-batch (a negative count against
 *   `lexicon_candidate_approvals_counts_check`, or a target with no candidate
 *   row) rolls the whole batch back and leaves zero rows;
 * - **`mode`/`batchId` must agree.** `batch` needs a non-null `batchId` and
 *   `single` must not carry one, matching
 *   `lexicon_candidate_approvals_batch_id_check`; the typed rejection means the
 *   caller gets a reason instead of a raw constraint error. A multi-record batch
 *   must share one non-null `batchId` and contain no repeated member — neither
 *   is expressible as a check constraint, which is why they are checked here;
 * - **the database keeps the last word.** Counts and the `document_kind` enum are
 *   *not* re-validated in TypeScript: they are check constraints, and this store
 *   deliberately lets them fire instead of bypassing them in the application
 *   layer (`AGENTS.md` §6/§8);
 * - **reads are ordered by approval time**, then by the row's candidate uuid and
 *   revision. That is deterministic, but it is not the derived-id collation the
 *   in-memory store uses — a uuid cannot reproduce it — so only the ordering
 *   *key* (time) is shared, not every tie-break.
 *
 * ## Identity: the derived id is not the foreign key
 *
 * `LexiconCandidateApprovalRecord.candidateId` is the derived candidate id from
 * `makeCandidateId()` (`kind|documentKind|stableKey|version|segmentIndex|normalizedText`),
 * while `lexicon_candidate_approvals.candidate_id` is a uuid referencing
 * `lexicon_candidates.id`. Each write therefore resolves the derived id to the
 * row it names, and refuses when it cannot do so truthfully. That resolution is
 * the one place this implementation cannot be a pure mapping — a consequence of
 * the surrogate primary key, not a choice made here.
 *
 * ## Duplication note
 *
 * The review-jsonb codec and the batch validation below are near-copies of the
 * candidate store's and the in-memory store's. That is deliberate: this slice
 * may not modify those files, and the two codecs must agree on the wire format
 * (`reviews` carries `reviewedAt` as an ISO string). Extracting a shared helper
 * is a reasonable follow-up once a third caller exists.
 */

import { and, asc, eq } from "drizzle-orm";

import * as schema from "@/src/shared/db/schema";
import type { Database } from "@/src/shared/db/client";
import { makeCandidateId, type LexiconCandidateReview } from "../domain/lexicon-candidate";
import { parseDerivedCandidateId } from "./drizzle-lexicon-candidate-repository";
import {
  decodeReviews as decodeCandidateReviews,
  encodeReviews as encodeCandidateReviews,
} from "./lexicon-candidate-review-codec";
import type {
  LexiconCandidateApprovalAuditStore,
  LexiconCandidateApprovalRecord,
  LexiconCandidateAuditQuery,
  LexiconCandidateAuditWriteOutcome,
} from "./lexicon-candidate-repository";

type ApprovalRow = typeof schema.lexiconCandidateApprovals.$inferSelect;
type CandidateRow = typeof schema.lexiconCandidates.$inferSelect;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Raised when an approval audit cannot be attached to a candidate row.
 *
 * The foreign key makes this a hard requirement rather than a policy: an audit
 * row that points at nothing would be a record of a decision about a candidate
 * that does not exist. It is a programming error (the pipeline writes the audit
 * immediately after persisting the approval), so it throws instead of returning
 * one of the contract's typed rejections — none of which means "no such
 * candidate".
 */
export class LexiconCandidateApprovalTargetError extends Error {
  readonly code = "CANDIDATE_APPROVAL_TARGET_UNRESOLVED" as const;
  readonly candidateId: string;

  constructor(candidateId: string, detail: string) {
    super(`Approval audit for candidate "${candidateId}" cannot be attached: ${detail}`);
    this.name = "LexiconCandidateApprovalTargetError";
    this.candidateId = candidateId;
  }
}

/** Raised when a stored approval row cannot be decoded without reinterpreting evidence. */
export class LexiconCandidateApprovalRowDecodeError extends Error {
  readonly code = "CANDIDATE_APPROVAL_ROW_DECODE_FAILED" as const;

  constructor(candidateId: string, detail: string) {
    super(`Stored approval audit for candidate "${candidateId}" could not be decoded: ${detail}`);
    this.name = "LexiconCandidateApprovalRowDecodeError";
  }
}

/**
 * `reviews` travels as jsonb and is encoded by the shared codec, so the approval
 * snapshot cannot drift from the candidate row it was copied out of.
 */
function encodeReviews(reviews: readonly LexiconCandidateReview[]): Record<string, unknown>[] {
  return [...encodeCandidateReviews(reviews)] as Record<string, unknown>[];
}

/**
 * Decode the review snapshot.
 *
 * A malformed *decision* is an error, not something to skip: these are the two
 * verdicts the approval was based on, and dropping one would leave an audit row
 * that cannot prove dual review. A missing *reason* is the historical shape and
 * decodes to "no reason" — older approval rows predate the field entirely.
 */
function decodeReviews(entries: readonly Record<string, unknown>[], candidateId: string): readonly LexiconCandidateReview[] {
  return decodeCandidateReviews(entries, (detail) => new LexiconCandidateApprovalRowDecodeError(candidateId, detail));
}

/**
 * The derived id of the candidate an approval row points at.
 *
 * Rebuilt from the candidate row's identity columns rather than stored: the
 * derived id is not a uuid and has no column (same reason the candidate store
 * reconstructs it in `findById`). The approval row's own snapshot columns are
 * used for the record's document fields, so a later change to the candidate
 * cannot rewrite what was audited.
 */
function toAuditRecord(approval: ApprovalRow, candidate: CandidateRow): LexiconCandidateApprovalRecord {
  // The derived id is rebuilt with the domain's own factory, so this file cannot
  // drift from `makeCandidateId()` the way the parser once did.
  const candidateId = makeCandidateId({
    kind: candidate.candidateKind as "lexeme" | "phrase",
    documentKind: candidate.documentKind as "article" | "media",
    stableKey: candidate.documentStableKey,
    version: candidate.documentVersion,
    segmentIndex: candidate.segmentIndex,
    normalizedText: candidate.normalizedText,
  });
  return {
    candidateId,
    mode: approval.mode as LexiconCandidateApprovalRecord["mode"],
    batchId: approval.batchId,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
    revision: approval.revision,
    documentKind: approval.documentKind as LexiconCandidateApprovalRecord["documentKind"],
    documentStableKey: approval.documentStableKey,
    documentVersion: approval.documentVersion,
    segmentIndex: approval.segmentIndex,
    reviews: decodeReviews(approval.reviews, candidateId),
    lexemes: approval.lexemeCount,
    phrases: approval.phraseCount,
  };
}

function rejection(
  code: Extract<LexiconCandidateAuditWriteOutcome, { status: "rejected" }>["code"],
  detail: string,
): LexiconCandidateAuditWriteOutcome {
  return { status: "rejected", code, detail };
}

/**
 * Batch-level rules the database cannot express.
 *
 * Returns a rejection, or `null` when the records may be written. Mirrors
 * `in-memory-lexicon-candidate-repository.ts` so both implementations refuse the
 * same inputs.
 */
function validateAuditBatch(records: readonly LexiconCandidateApprovalRecord[]): LexiconCandidateAuditWriteOutcome | null {
  if (records.length === 0) return null;

  const seen = new Set<string>();
  const batchIds = new Set<string>();
  for (const record of records) {
    const modeConsistent = record.mode === "batch" ? record.batchId !== null : record.batchId === null;
    if (!modeConsistent) {
      return rejection(
        "CANDIDATE_AUDIT_MODE_INCONSISTENT",
        `A "${record.mode}" approval record must ${record.mode === "batch" ? "carry" : "not carry"} a batchId.`,
      );
    }
    if (record.batchId !== null) batchIds.add(record.batchId);
    const key = JSON.stringify([record.candidateId, record.revision]);
    if (seen.has(key)) {
      return rejection(
        "CANDIDATE_AUDIT_DUPLICATE_IN_CALL",
        `Candidate "${record.candidateId}" revision ${record.revision} appears twice in one batch.`,
      );
    }
    seen.add(key);
  }

  if (records.length > 1 && (records.some((record) => record.mode === "single") || batchIds.size !== 1 || batchIds.has(""))) {
    return rejection(
      "CANDIDATE_AUDIT_BATCH_ID_INCONSISTENT",
      "Every record of one bulk run must share the same non-null batchId.",
    );
  }
  return null;
}

/** The candidate row a record names, or a thrown error explaining why there is none. */
async function resolveCandidateRow(
  transaction: Transaction,
  record: LexiconCandidateApprovalRecord,
): Promise<CandidateRow> {
  const identity = parseDerivedCandidateId(record.candidateId);
  if (!identity) {
    throw new LexiconCandidateApprovalTargetError(
      record.candidateId,
      "its id is not a candidate identity (kind|documentKind|stableKey|version|segmentIndex|normalizedText)",
    );
  }
  // The record's snapshot and its id must describe the same span; otherwise the
  // audit would claim one document while being attached to another.
  const snapshotAgrees =
    record.documentKind === identity.documentKind
    && record.documentStableKey === identity.documentStableKey
    && record.documentVersion === identity.documentVersion
    && record.segmentIndex === identity.segmentIndex;
  if (!snapshotAgrees) {
    throw new LexiconCandidateApprovalTargetError(
      record.candidateId,
      "its document snapshot disagrees with its own id",
    );
  }

  const rows = await transaction
    .select()
    .from(schema.lexiconCandidates)
    .where(and(
      eq(schema.lexiconCandidates.candidateKind, identity.kind),
      eq(schema.lexiconCandidates.documentKind, identity.documentKind),
      eq(schema.lexiconCandidates.documentStableKey, identity.documentStableKey),
      eq(schema.lexiconCandidates.documentVersion, identity.documentVersion),
      eq(schema.lexiconCandidates.segmentIndex, identity.segmentIndex),
      eq(schema.lexiconCandidates.normalizedText, identity.normalizedText),
    ))
    .limit(2);
  if (rows.length === 0) {
    throw new LexiconCandidateApprovalTargetError(record.candidateId, "no stored candidate row matches it");
  }
  if (rows.length > 1) {
    throw new LexiconCandidateApprovalTargetError(record.candidateId, "it matches more than one stored candidate row");
  }
  return rows[0]!;
}

/**
 * Postgres approval-audit store.
 *
 * Every method is safe to retry: the unique index plus `do nothing` makes a
 * repeated approval a reported no-op rather than a second row or an exception.
 */
export function createDrizzleLexiconCandidateApprovalAuditStore(database: Database): LexiconCandidateApprovalAuditStore {
  async function insertApprovalAudits(
    records: readonly LexiconCandidateApprovalRecord[],
  ): Promise<LexiconCandidateAuditWriteOutcome> {
    const invalid = validateAuditBatch(records);
    if (invalid) return invalid;
    if (records.length === 0) return { status: "recorded", inserted: 0, duplicates: 0 };

    // One transaction for the whole batch: a member that trips a check
    // constraint, or names a candidate that is not stored, rolls back every row
    // written by this call (AGENTS.md §8: no partial publication).
    return database.transaction(async (transaction) => {
      let inserted = 0;
      for (const record of records) {
        const candidate = await resolveCandidateRow(transaction, record);
        const written = await transaction
          .insert(schema.lexiconCandidateApprovals)
          .values({
            candidateId: candidate.id,
            revision: record.revision,
            mode: record.mode,
            batchId: record.batchId,
            approvedBy: record.approvedBy,
            approvedAt: record.approvedAt,
            documentKind: record.documentKind,
            documentStableKey: record.documentStableKey,
            documentVersion: record.documentVersion,
            segmentIndex: record.segmentIndex,
            reviews: encodeReviews(record.reviews),
            lexemeCount: record.lexemes,
            phraseCount: record.phrases,
          })
          // One approval record per candidate revision: a retry is reported as a
          // duplicate by the caller-facing result, and the first trail entry —
          // not the retry — is what stays on record.
          .onConflictDoNothing({
            target: [
              schema.lexiconCandidateApprovals.candidateId,
              schema.lexiconCandidateApprovals.revision,
            ],
          })
          .returning({ id: schema.lexiconCandidateApprovals.id });
        if (written.length > 0) inserted += 1;
      }
      return { status: "recorded", inserted, duplicates: records.length - inserted };
    });
  }

  return {
    async insertApprovalAudit(record) {
      return insertApprovalAudits([record]);
    },

    async insertApprovalAudits(records) {
      return insertApprovalAudits(records);
    },

    async listApprovalAudits(query: LexiconCandidateAuditQuery) {
      // The query speaks derived ids; the column holds a uuid. Resolving first
      // keeps the store's read semantics identical to the in-memory one, and a
      // candidate that is not stored simply has no approvals.
      let candidateUuid: string | null = null;
      if (query.candidateId !== undefined) {
        const identity = parseDerivedCandidateId(query.candidateId);
        if (!identity) return [];
        const [row] = await database
          .select({ id: schema.lexiconCandidates.id })
          .from(schema.lexiconCandidates)
          .where(and(
            eq(schema.lexiconCandidates.candidateKind, identity.kind),
            eq(schema.lexiconCandidates.documentKind, identity.documentKind),
            eq(schema.lexiconCandidates.documentStableKey, identity.documentStableKey),
            eq(schema.lexiconCandidates.documentVersion, identity.documentVersion),
            eq(schema.lexiconCandidates.segmentIndex, identity.segmentIndex),
            eq(schema.lexiconCandidates.normalizedText, identity.normalizedText),
          ))
          .limit(1);
        if (!row) return [];
        candidateUuid = row.id;
      }

      const rows = await database
        .select({ approval: schema.lexiconCandidateApprovals, candidate: schema.lexiconCandidates })
        .from(schema.lexiconCandidateApprovals)
        .innerJoin(
          schema.lexiconCandidates,
          eq(schema.lexiconCandidateApprovals.candidateId, schema.lexiconCandidates.id),
        )
        .where(and(
          candidateUuid === null ? undefined : eq(schema.lexiconCandidateApprovals.candidateId, candidateUuid),
          query.batchId === undefined ? undefined : eq(schema.lexiconCandidateApprovals.batchId, query.batchId),
        ))
        .orderBy(
          asc(schema.lexiconCandidateApprovals.approvedAt),
          asc(schema.lexiconCandidateApprovals.candidateId),
          asc(schema.lexiconCandidateApprovals.revision),
        );
      return rows.map((row) => toAuditRecord(row.approval, row.candidate));
    },
  };
}
