/**
 * Postgres lexicon candidate repository (LEX-INDEX-001 slice 6 prerequisite).
 *
 * ## Status: implemented, and exercised against a real database
 *
 * Migration `0042_stale_starbolt.sql` created `lexicon_candidates` and
 * `lexicon_candidate_approvals` and has been applied to the target database, so
 * this is no longer "code only". What that means in practice:
 *
 * - `scripts/verify-drizzle-candidate-repository.ts` drives this factory inside
 *   a transaction that is rolled back, so `.set()` shapes, the
 *   `onConflictDoNothing` target, the `for update` read and the jsonb round-trip
 *   have all executed real SQL;
 * - `scripts/lexicon-indexing-canary.ts` constructs it for the canary run;
 * - `tests/database/lexicon-candidates-migration.test.ts` re-applies the
 *   migration artifact on PGlite, so the table shape this file maps is checked
 *   on every run.
 *
 * ## Where the approval audit lives
 *
 * This file implements {@link LexiconCandidateRepository} only. The audit trail
 * is a separate concern with a separate table: `lexicon_candidates` has **no
 * column** for `mode`, `batchId`, `lexemes` or `phrases`, so an audit written
 * into the candidate row would have to drop the batch correlation that
 * ADR-0011 §5 requires. It lives in `lexicon_candidate_approvals` and its store
 * is `drizzle-lexicon-candidate-approval-audit-store.ts`.
 *
 * ## Identity
 *
 * The domain id returned by `makeCandidateId()` is not a uuid, so it cannot be
 * the primary key. Every read and write below goes through the six columns of
 * `lexicon_candidates_identity_uidx` and reproduces the domain id from them with
 * `makeCandidateId()`. `parseDerivedCandidateId()` therefore also refuses an id
 * whose stable key contains `|` instead of guessing (stable keys are slugs in
 * this codebase; `makeCandidateId()` itself already assumes that).
 *
 * ## Compare-and-swap
 *
 * `save()` locks the row (`for update`), compares the stored revision to
 * `expectedRevision` inside the transaction and only then issues
 * `update ... where revision = expectedRevision returning *`. A stale caller
 * gets `conflict` plus the stored state and no `set()` ever runs. A write that
 * arrives after the row moved cannot overwrite it: the revision predicate is
 * part of the `update` itself, so the loser of a race writes zero rows.
 */

import { and, asc, eq, isNotNull } from "drizzle-orm";

import * as schema from "@/src/shared/db/schema";
import type { Database } from "@/src/shared/db/client";
import { makeCandidateId } from "../domain/lexicon-candidate";
import {
  LexiconCandidateIdentityAmbiguousError,
  candidateStorageIdentity,
  validateCandidateIdentity,
  validateCandidateRevision,
  validateCandidateWriteShape,
  type LexiconCandidateRecord,
  type LexiconCandidateRepository,
  type LexiconCandidateSaveOutcome,
  type LexiconCandidateSourceKey,
} from "./lexicon-candidate-repository";

type CandidateRow = typeof schema.lexiconCandidates.$inferSelect;

/** Raised when a stored row cannot be decoded without reinterpreting evidence. */
export class LexiconCandidateRowDecodeError extends Error {
  readonly code = "CANDIDATE_ROW_DECODE_FAILED" as const;

  constructor(candidateId: string, detail: string) {
    super(`Stored lexicon candidate "${candidateId}" could not be decoded: ${detail}`);
    this.name = "LexiconCandidateRowDecodeError";
  }
}

/**
 * The inverse of `makeCandidateId()`, and it must mirror it column for column.
 *
 * It previously parsed five fields while `makeCandidateId()` emitted six: when
 * `documentKind` was added to the id (so the id would line up with the table's
 * identity unique index), this parser was not updated. The pattern then read
 * `documentKind` as the stable key and failed its next `(\d+)` against the real
 * stable key, so it matched nothing and `findById` returned `null` for every id
 * the current `makeCandidateId()` can produce.
 *
 * Type checking could not catch it — the returned shape is a subset of what the
 * caller needs, and the caller handled `null` — and neither could any test,
 * because the in-memory repository keys rows by the six columns directly and
 * never parses an id. Only executing a real query surfaced it.
 */
const derivedIdPattern = /^(lexeme|phrase)\|(article|media)\|([^|]+)\|(\d+)\|(\d+)\|([\s\S]*)$/u;

/**
 * Split a derived candidate id back into the identity columns it was built from.
 *
 * Returns `null` for anything that is not exactly
 * `kind|documentKind|stableKey|version|segmentIndex|normalizedText`, including a
 * stable key that contains `|` — the join in `makeCandidateId()` is not
 * escapable, so such an id is ambiguous and must not be guessed at.
 */
export function parseDerivedCandidateId(id: string): Readonly<{
  kind: "lexeme" | "phrase";
  documentKind: "article" | "media";
  documentStableKey: string;
  documentVersion: number;
  segmentIndex: number;
  normalizedText: string;
}> | null {
  const match = derivedIdPattern.exec(id);
  if (!match) return null;
  const [, kind, documentKind, documentStableKey, documentVersion, segmentIndex, normalizedText] = match;
  return {
    kind: kind as "lexeme" | "phrase",
    documentKind: documentKind as "article" | "media",
    documentStableKey: documentStableKey!,
    documentVersion: Number(documentVersion),
    segmentIndex: Number(segmentIndex),
    normalizedText: normalizedText!,
  };
}

/**
 * The identity predicate, over the same six columns as the table's identity
 * unique index.
 *
 * `documentKind` is included whenever the caller has it. Writes always have it,
 * and since the id encodes it, an id-only lookup does too — an id names exactly
 * one row. The membership test is kept because the two callers reach here with
 * structurally different objects, and a future caller without the field should
 * narrow rather than silently match across document kinds.
 */
function identityWhere(
  identity: ReturnType<typeof candidateStorageIdentity> | ReturnType<typeof parseDerivedCandidateId>,
): ReturnType<typeof and> {
  if (!identity) throw new Error("LEXICON_CANDIDATE_IDENTITY_MISSING");
  return and(
    eq(schema.lexiconCandidates.candidateKind, identity.kind),
    "documentKind" in identity ? eq(schema.lexiconCandidates.documentKind, identity.documentKind) : undefined,
    eq(schema.lexiconCandidates.documentStableKey, identity.documentStableKey),
    eq(schema.lexiconCandidates.documentVersion, identity.documentVersion),
    eq(schema.lexiconCandidates.segmentIndex, identity.segmentIndex),
    eq(schema.lexiconCandidates.normalizedText, identity.normalizedText),
  );
}

/**
 * Decode one review record.
 *
 * A malformed entry is an error, not something to skip: these rows are what
 * proves dual review before approval, and silently dropping one would reinterpret
 * evidence that a human decision was based on.
 */
function decodeReviews(row: CandidateRow): LexiconCandidateRecord["candidate"]["reviews"] {
  const candidateId = toCandidateId(row);
  return row.reviews.map((entry, index) => {
    const dimension = entry.dimension;
    const outcome = entry.outcome;
    const reviewerReference = entry.reviewerReference;
    const reviewedAt = entry.reviewedAt;
    if (dimension !== "content-es-ES" && dimension !== "teaching-zh-CN") {
      throw new LexiconCandidateRowDecodeError(candidateId, `review ${index} has an unknown dimension`);
    }
    if (outcome !== "pass" && outcome !== "fail") {
      throw new LexiconCandidateRowDecodeError(candidateId, `review ${index} has an unknown outcome`);
    }
    if (typeof reviewerReference !== "string" || reviewerReference.length === 0) {
      throw new LexiconCandidateRowDecodeError(candidateId, `review ${index} has no reviewer reference`);
    }
    const reviewedAtDate = typeof reviewedAt === "string" || reviewedAt instanceof Date ? new Date(reviewedAt) : null;
    if (!reviewedAtDate || Number.isNaN(reviewedAtDate.getTime())) {
      throw new LexiconCandidateRowDecodeError(candidateId, `review ${index} has no usable reviewedAt`);
    }
    return { dimension, outcome, reviewerReference, reviewedAt: reviewedAtDate };
  });
}

function toCandidateId(row: CandidateRow): string {
  return makeCandidateId({
    kind: row.candidateKind as "lexeme" | "phrase",
    documentKind: row.documentKind as "article" | "media",
    stableKey: row.documentStableKey,
    version: row.documentVersion,
    segmentIndex: row.segmentIndex,
    normalizedText: row.normalizedText,
  });
}

/** Row -> contract record. `source_text` is the stored surface form. */
function toRecord(row: CandidateRow): LexiconCandidateRecord {
  return {
    candidate: {
      id: toCandidateId(row),
      kind: row.candidateKind as "lexeme" | "phrase",
      surfaceText: row.sourceText,
      normalizedText: row.normalizedText,
      lemma: row.lemma,
      partOfSpeech: row.partOfSpeech,
      meaningZh: row.meaningZh,
      status: row.status as LexiconCandidateRecord["candidate"]["status"],
      revision: row.revision,
      source: {
        documentKind: row.documentKind as "article" | "media",
        documentStableKey: row.documentStableKey,
        documentVersion: row.documentVersion,
        segmentIndex: row.segmentIndex,
        contextBefore: row.contextBefore,
        contextAfter: row.contextAfter,
        sourceTitle: row.sourceTitle,
        sourceKind: row.sourceKind,
      },
      reviews: decodeReviews(row),
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      rejectedReason: row.rejectedReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    provenance: {
      provider: row.provider,
      modelVersion: row.modelVersion,
      confidence: row.confidence,
    },
  };
}

function toValues(record: LexiconCandidateRecord) {
  const { candidate, provenance } = record;
  return {
    candidateKind: candidate.kind,
    documentKind: candidate.source.documentKind,
    documentStableKey: candidate.source.documentStableKey,
    documentVersion: candidate.source.documentVersion,
    segmentIndex: candidate.source.segmentIndex,
    sourceText: candidate.surfaceText,
    normalizedText: candidate.normalizedText,
    lemma: candidate.lemma,
    partOfSpeech: candidate.partOfSpeech,
    meaningZh: candidate.meaningZh,
    contextBefore: candidate.source.contextBefore,
    contextAfter: candidate.source.contextAfter,
    sourceTitle: candidate.source.sourceTitle,
    sourceKind: candidate.source.sourceKind,
    provider: provenance.provider,
    modelVersion: provenance.modelVersion,
    confidence: provenance.confidence,
    status: candidate.status,
    revision: candidate.revision,
    // Dates travel as ISO strings inside jsonb; `decodeReviews` reads them back.
    reviews: candidate.reviews.map((review) => ({
      dimension: review.dimension,
      outcome: review.outcome,
      reviewerReference: review.reviewerReference,
      reviewedAt: review.reviewedAt.toISOString(),
    })),
    approvedBy: candidate.approvedBy,
    approvedAt: candidate.approvedAt,
    rejectedReason: candidate.rejectedReason,
    updatedAt: candidate.updatedAt,
  };
}

/**
 * Postgres candidate store.
 *
 * Implements {@link LexiconCandidateRepository}. The approval audit store is a
 * sibling concern with its own table and its own factory; see
 * `drizzle-lexicon-candidate-approval-audit-store.ts` and the file header.
 */
export function createDrizzleLexiconCandidateRepository(database: Database): LexiconCandidateRepository {
  function conflictFrom(
    row: CandidateRow,
    candidateId: string,
    expectedRevision: number,
  ): LexiconCandidateSaveOutcome {
    return {
      status: "conflict",
      candidateId,
      expectedRevision,
      actualRevision: row.revision,
      current: toRecord(row),
    };
  }

  return {
    async create(record) {
      const failure = validateCandidateWriteShape(record) ?? validateCandidateRevision(record.candidate, null);
      if (failure) return failure;

      const identity = candidateStorageIdentity(record.candidate);
      const inserted = await database
        .insert(schema.lexiconCandidates)
        .values({
          ...toValues(record),
          // `updatedAt` above is the caller's clock; `createdAt` is written once
          // here and never touched again by `save()`.
          createdAt: record.candidate.createdAt,
        })
        // The identity unique index makes a repeated extraction a no-op, so an
        // already reviewed or approved candidate is never reset to `discovered`.
        .onConflictDoNothing({
          target: [
            schema.lexiconCandidates.candidateKind,
            schema.lexiconCandidates.documentKind,
            schema.lexiconCandidates.documentStableKey,
            schema.lexiconCandidates.documentVersion,
            schema.lexiconCandidates.segmentIndex,
            schema.lexiconCandidates.normalizedText,
          ],
        })
        .returning();
      const created = inserted[0];
      if (created) return { status: "created", record: toRecord(created) };

      // The insert lost to the identity unique index: read back the row that is
      // already there instead of overwriting it.
      const existing = await database
        .select()
        .from(schema.lexiconCandidates)
        .where(identityWhere(identity))
        .limit(2);
      if (existing.length > 1) throw new LexiconCandidateIdentityAmbiguousError(record.candidate.id);
      const row = existing[0];
      if (!row) throw new Error("LEXICON_CANDIDATE_CREATE_FAILED");
      return { status: "exists", record: toRecord(row) };
    },

    async findById(id) {
      const identity = parseDerivedCandidateId(id);
      // An id `makeCandidateId()` could not have produced cannot be stored.
      if (!identity) return null;
      const rows = await database
        .select()
        .from(schema.lexiconCandidates)
        .where(identityWhere(identity))
        .limit(2);
      if (rows.length > 1) throw new LexiconCandidateIdentityAmbiguousError(id);
      const row = rows[0];
      return row ? toRecord(row) : null;
    },

    async save(input): Promise<LexiconCandidateSaveOutcome> {
      // Identity is a caller bug that no stored state can make valid, so it is
      // answered first; everything else is decided against real stored state.
      const identityFailure = validateCandidateIdentity(input.candidate);
      if (identityFailure) return identityFailure;

      const identity = candidateStorageIdentity(input.candidate);
      return database.transaction(async (transaction) => {
        const rows = await transaction
          .select()
          .from(schema.lexiconCandidates)
          .where(identityWhere(identity))
          .limit(2)
          .for("update");
        if (rows.length > 1) throw new LexiconCandidateIdentityAmbiguousError(input.candidate.id);
        const stored = rows[0];
        if (!stored) return { status: "not_found", candidateId: input.candidate.id };

        // State first, exactly like the in-memory store: a stale caller must
        // learn that newer state exists, not that its snapshot is malformed.
        if (stored.revision !== input.expectedRevision) {
          return conflictFrom(stored, input.candidate.id, input.expectedRevision);
        }

        const provenance = input.provenance ?? {
          provider: stored.provider,
          modelVersion: stored.modelVersion,
          confidence: stored.confidence,
        };
        const failure =
          validateCandidateWriteShape({ candidate: input.candidate, provenance })
          ?? validateCandidateRevision(input.candidate, input.expectedRevision);
        if (failure) return failure;

        const updated = await transaction
          .update(schema.lexiconCandidates)
          .set({ ...toValues({ candidate: input.candidate, provenance }) })
          .where(and(
            identityWhere(identity),
            // The CAS lives in the predicate, so a write that lost the race
            // updates zero rows instead of overwriting newer state.
            eq(schema.lexiconCandidates.revision, input.expectedRevision),
          ))
          .returning();
        const row = updated[0];
        if (row) return { status: "saved", record: toRecord(row) };

        // Unreachable while the row is locked above; kept so a future refactor
        // cannot turn a lost update into a silent success.
        const [current] = await transaction
          .select()
          .from(schema.lexiconCandidates)
          .where(identityWhere(identity))
          .limit(1);
        if (!current) return { status: "not_found", candidateId: input.candidate.id };
        return conflictFrom(current, input.candidate.id, input.expectedRevision);
      });
    },

    async listBySource(source) {
      return selectBySource(database, source, false);
    },

    async listIndexable(source) {
      return selectBySource(database, source, true);
    },
  };
}

/**
 * Candidates of one document version.
 *
 * `onlyIndexable` adds the approved status *and* the approval audit pair, so a
 * row that somehow claims `approved` without a recorded approver is never handed
 * to the corpus gate — the same defence the in-memory store applies.
 *
 * Ordering matches the in-memory store (`segmentIndex`, then kind, then
 * normalized text) so a batch approval sees the same sequence in both.
 */
async function selectBySource(
  database: Database,
  source: LexiconCandidateSourceKey,
  onlyIndexable: boolean,
): Promise<readonly LexiconCandidateRecord[]> {
  const rows = await database
    .select()
    .from(schema.lexiconCandidates)
    .where(and(
      eq(schema.lexiconCandidates.documentKind, source.documentKind),
      eq(schema.lexiconCandidates.documentStableKey, source.documentStableKey),
      eq(schema.lexiconCandidates.documentVersion, source.documentVersion),
      onlyIndexable ? eq(schema.lexiconCandidates.status, "approved") : undefined,
      onlyIndexable ? isNotNull(schema.lexiconCandidates.approvedBy) : undefined,
      onlyIndexable ? isNotNull(schema.lexiconCandidates.approvedAt) : undefined,
    ))
    .orderBy(
      asc(schema.lexiconCandidates.segmentIndex),
      asc(schema.lexiconCandidates.candidateKind),
      asc(schema.lexiconCandidates.normalizedText),
    );
  return rows.map(toRecord);
}
