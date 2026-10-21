// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "@/src/modules/content-acquisition/domain/review-identity";
import { makeCandidateId, type LexiconCandidate } from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";
import {
  LexiconCandidateApprovalTargetError,
  createDrizzleLexiconCandidateApprovalAuditStore,
} from "@/src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-approval-audit-store";
import { createDrizzleLexiconCandidateRepository } from "@/src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-repository";
import type {
  LexiconCandidateApprovalRecord,
  LexiconCandidateRecord,
} from "@/src/modules/lexicon-corpus/repositories/lexicon-candidate-repository";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

/**
 * The Drizzle approval-audit store against a real Postgres engine.
 *
 * The table arrives the way it arrives in production: the test reads the
 * migration artifact from `drizzle/` and executes it, rather than hand-writing
 * equivalent DDL. That keeps the thing under test — the store's mapping — from
 * drifting away from the schema that actually ships, and a hand-written CREATE
 * TABLE would have hidden exactly the column-name and constraint mistakes this
 * suite exists to catch.
 *
 * Everything runs on PGlite, an in-process Postgres, so no database is touched
 * and there is nothing to clean up afterwards.
 */

const migrationPath = path.join(process.cwd(), "drizzle", "0042_stale_starbolt.sql");

const approvalTime = new Date("2026-10-11T05:00:00.000Z");
const later = new Date("2026-10-11T06:30:00.000Z");
const OWNER = OWNER_AUTHORIZED_REVIEWER_REFERENCE;

/** Apply the real migration, statement by statement, exactly as `drizzle-kit` would. */
async function applyMigration(client: PGlite): Promise<void> {
  const raw = await readFile(migrationPath, "utf8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await client.exec(statement);
}

function candidate(overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  const base: Omit<LexiconCandidate, "id"> = {
    kind: "lexeme",
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    meaningZh: null,
    status: "approved",
    revision: 5,
    source: {
      documentKind: "article",
      documentStableKey: "article.canary",
      documentVersion: 1,
      segmentIndex: 0,
      contextBefore: "Y en Panamá un ",
      contextAfter: " de magnitud 7.2",
      sourceTitle: "Alerta de tsunami",
      sourceKind: "article-rss",
    },
    reviews: [
      { dimension: "content-es-ES", outcome: "pass", reviewerReference: OWNER, reviewedAt: approvalTime },
      { dimension: "teaching-zh-CN", outcome: "pass", reviewerReference: OWNER, reviewedAt: approvalTime },
    ],
    approvedBy: OWNER,
    approvedAt: approvalTime,
    rejectedReason: null,
    createdAt: approvalTime,
    updatedAt: approvalTime,
    ...overrides,
  };
  return {
    ...base,
    id: makeCandidateId({
      kind: base.kind,
      documentKind: base.source.documentKind,
      stableKey: base.source.documentStableKey,
      version: base.source.documentVersion,
      segmentIndex: base.source.segmentIndex,
      normalizedText: base.normalizedText,
    }),
  };
}

function audit(
  stored: LexiconCandidateRecord,
  overrides: Partial<LexiconCandidateApprovalRecord> = {},
): LexiconCandidateApprovalRecord {
  return {
    candidateId: stored.candidate.id,
    mode: "single",
    batchId: null,
    approvedBy: OWNER,
    approvedAt: approvalTime,
    revision: stored.candidate.revision,
    documentKind: stored.candidate.source.documentKind,
    documentStableKey: stored.candidate.source.documentStableKey,
    documentVersion: stored.candidate.source.documentVersion,
    segmentIndex: stored.candidate.source.segmentIndex,
    reviews: stored.candidate.reviews,
    lexemes: 1,
    phrases: 0,
    ...overrides,
  };
}

/**
 * Assert a rejection that names a database constraint.
 *
 * Drizzle wraps driver errors (`Failed query: …`), and the constraint name lives
 * on the wrapped cause, so checking only the top-level message would assert
 * nothing about *why* the write was refused.
 */
async function expectConstraintRejection(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await run();
  } catch (error) {
    const chain: string[] = [];
    let current: unknown = error;
    while (current instanceof Error && chain.length < 5) {
      chain.push(`${current.name}: ${current.message}`);
      current = (current as { cause?: unknown }).cause;
    }
    expect(chain.join(" | ")).toMatch(pattern);
    return;
  }
  throw new Error("expected the write to be refused");
}

describe("drizzle approval audit store", () => {
  let client: PGlite;
  let database: Database;
  let audits: ReturnType<typeof createDrizzleLexiconCandidateApprovalAuditStore>;
  let candidates: ReturnType<typeof createDrizzleLexiconCandidateRepository>;

  async function seed(overrides: Partial<LexiconCandidate> = {}): Promise<LexiconCandidateRecord> {
    const created = await candidates.create({
      candidate: candidate(overrides),
      provenance: { provider: "fake", modelVersion: "fake-lexicon-extraction-v1", confidence: 100 },
    });
    if (created.status !== "created") throw new Error(`seed failed: ${created.status}`);
    return created.record;
  }

  /** Rows physically present for one batch, read with SQL rather than through the store. */
  async function rowsForBatch(batchId: string): Promise<number> {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n from lexicon_candidate_approvals where batch_id = $1`,
      [batchId],
    );
    return result.rows[0]?.n ?? -1;
  }

  beforeEach(async () => {
    client = new PGlite();
    await applyMigration(client);
    database = drizzle(client, { schema }) as unknown as Database;
    audits = createDrizzleLexiconCandidateApprovalAuditStore(database);
    candidates = createDrizzleLexiconCandidateRepository(database);
  });

  afterEach(async () => {
    await client.close();
  });

  it("writes one audit row and reads it back with dates and both review dimensions intact", async () => {
    const stored = await seed();

    const written = await audits.insertApprovalAudit(audit(stored));
    expect(written).toEqual({ status: "recorded", inserted: 1, duplicates: 0 });

    const read = await audits.listApprovalAudits({ candidateId: stored.candidate.id });
    expect(read).toHaveLength(1);
    const record = read[0]!;
    expect(record.batchId).toBeNull();
    expect(record.mode).toBe("single");
    expect(record.approvedBy).toBe(OWNER);
    expect(record.revision).toBe(5);
    expect(record.documentKind).toBe("article");
    expect(record.documentStableKey).toBe("article.canary");
    expect(record.documentVersion).toBe(1);
    expect(record.segmentIndex).toBe(0);
    expect(record.lexemes).toBe(1);
    expect(record.phrases).toBe(0);

    // jsonb round-trip: written as ISO strings, read back as Dates.
    expect(record.reviews).toHaveLength(2);
    expect(record.reviews.map((review) => `${review.dimension}:${review.outcome}`)).toEqual([
      "content-es-ES:pass",
      "teaching-zh-CN:pass",
    ]);
    expect(record.reviews[0]?.reviewedAt).toBeInstanceOf(Date);
    expect(record.reviews[0]?.reviewedAt.toISOString()).toBe(approvalTime.toISOString());
    // timestamp with time zone round-trips as a Date.
    expect(record.approvedAt).toBeInstanceOf(Date);
    expect(record.approvedAt.toISOString()).toBe(approvalTime.toISOString());
  });

  it("reports a repeated (candidateId, revision) approval instead of writing it twice", async () => {
    const stored = await seed();
    const first = await audits.insertApprovalAudit(audit(stored));
    expect(first).toEqual({ status: "recorded", inserted: 1, duplicates: 0 });

    // The retry differs in every mutable field: none of it may reach the table.
    const retry = await audits.insertApprovalAudit(audit(stored, {
      approvedBy: "someone-else",
      approvedAt: later,
      lexemes: 9,
      phrases: 4,
    }));
    expect(retry).toEqual({ status: "recorded", inserted: 0, duplicates: 1 });

    const counted = await client.query<{ n: number }>(
      `select count(*)::int as n from lexicon_candidate_approvals`,
    );
    expect(counted.rows[0]?.n).toBe(1);

    const [kept] = await audits.listApprovalAudits({ candidateId: stored.candidate.id });
    expect(kept?.approvedBy).toBe(OWNER);
    expect(kept?.approvedAt.toISOString()).toBe(approvalTime.toISOString());
    expect(kept?.lexemes).toBe(1);
  });

  it("keeps a batch at one row per candidate sharing one batchId", async () => {
    const first = await seed();
    const second = await seed({
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo", source: { ...candidate().source, segmentIndex: 1 },
    });
    const third = await seed({
      surfaceText: "réplica", normalizedText: "replica", lemma: "replica", source: { ...candidate().source, segmentIndex: 2 },
    });

    const written = await audits.insertApprovalAudits([
      audit(first, { mode: "batch", batchId: "batch-9" }),
      audit(second, { mode: "batch", batchId: "batch-9" }),
      audit(third, { mode: "batch", batchId: "batch-9" }),
    ]);
    expect(written).toEqual({ status: "recorded", inserted: 3, duplicates: 0 });

    const batch = await audits.listApprovalAudits({ batchId: "batch-9" });
    expect(batch).toHaveLength(3);
    expect(batch.every((record) => record.mode === "batch" && record.batchId === "batch-9")).toBe(true);
    // Ordered by approvedAt then candidate id, so the sequence is deterministic.
    expect([...batch].map((record) => record.candidateId).sort()).toEqual(
      [first, second, third].map((record) => record.candidate.id).sort(),
    );
    expect(await rowsForBatch("batch-9")).toBe(3);
    // A candidate-scoped read sees only its own approval.
    expect(await audits.listApprovalAudits({ candidateId: second.candidate.id })).toHaveLength(1);

    // Re-running the same batch adds nothing and reports every member as a duplicate.
    const replay = await audits.insertApprovalAudits([
      audit(first, { mode: "batch", batchId: "batch-9" }),
      audit(second, { mode: "batch", batchId: "batch-9" }),
      audit(third, { mode: "batch", batchId: "batch-9" }),
    ]);
    expect(replay).toEqual({ status: "recorded", inserted: 0, duplicates: 3 });
    expect(await rowsForBatch("batch-9")).toBe(3);
  });

  it("rolls the whole batch back when one member breaks a check constraint", async () => {
    const first = await seed();
    const second = await seed({
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo", source: { ...candidate().source, segmentIndex: 1 },
    });

    // `lexicon_candidate_approvals_counts_check` is the database's rule, not the
    // store's: the store must let it fire rather than sanitise the value away.
    await expectConstraintRejection(
      () => audits.insertApprovalAudits([
        audit(first, { mode: "batch", batchId: "batch-bad" }),
        audit(second, { mode: "batch", batchId: "batch-bad", lexemes: -1 }),
      ]),
      /counts_check/,
    );

    // All-or-nothing: the first member was written inside the transaction and
    // must have gone with it.
    expect(await rowsForBatch("batch-bad")).toBe(0);
    expect(await audits.listApprovalAudits({})).toHaveLength(0);
  });

  it("rolls the whole batch back when a member names a candidate that is not stored", async () => {
    const stored = await seed();
    const missing = candidate({ surfaceText: "fantasma", normalizedText: "fantasma", lemma: "fantasma" });
    const ghost: LexiconCandidateRecord = {
      candidate: missing,
      provenance: { provider: "fake", modelVersion: null, confidence: null },
    };

    await expect(audits.insertApprovalAudits([
      audit(stored, { mode: "batch", batchId: "batch-ghost" }),
      audit(ghost, { mode: "batch", batchId: "batch-ghost" }),
    ])).rejects.toBeInstanceOf(LexiconCandidateApprovalTargetError);

    expect(await rowsForBatch("batch-ghost")).toBe(0);
    expect(await audits.listApprovalAudits({})).toHaveLength(0);
  });

  it("refuses an audit whose snapshot disagrees with the id it carries", async () => {
    const stored = await seed();

    // A media claim on an article-derived id: attaching it would point the audit
    // at a document the id does not name.
    await expect(
      audits.insertApprovalAudit(audit(stored, { documentKind: "media" })),
    ).rejects.toBeInstanceOf(LexiconCandidateApprovalTargetError);
    await expect(
      audits.insertApprovalAudit(audit(stored, { documentStableKey: "article.other" })),
    ).rejects.toBeInstanceOf(LexiconCandidateApprovalTargetError);
    expect(await audits.listApprovalAudits({})).toHaveLength(0);
  });

  it("mirrors the table's mode/batchId constraint and batch-level rules", async () => {
    const first = await seed();
    const second = await seed({
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo", source: { ...candidate().source, segmentIndex: 1 },
    });

    // The store's own check, so the caller gets a reason instead of a driver error.
    const mismatched = await audits.insertApprovalAudit(audit(first, { mode: "single", batchId: "batch-1" }));
    expect(mismatched.status).toBe("rejected");
    if (mismatched.status === "rejected") expect(mismatched.code).toBe("CANDIDATE_AUDIT_MODE_INCONSISTENT");

    const missingBatch = await audits.insertApprovalAudit(audit(first, { mode: "batch", batchId: null }));
    expect(missingBatch.status).toBe("rejected");
    if (missingBatch.status === "rejected") expect(missingBatch.code).toBe("CANDIDATE_AUDIT_MODE_INCONSISTENT");

    // ...and the same rule exists in the database, for any writer.
    await expect(
      client.query(
        `insert into lexicon_candidate_approvals
           (candidate_id, revision, mode, batch_id, approved_by, approved_at,
            document_kind, document_stable_key, document_version, segment_index)
         select id, 5, 'single', 'batch-1', 'x', now(), 'article', 'article.canary', 1, 0
         from lexicon_candidates limit 1`,
      ),
    ).rejects.toThrow(/batch_id_check/);

    const duplicateInCall = await audits.insertApprovalAudits([
      audit(first, { mode: "batch", batchId: "batch-1" }),
      audit(first, { mode: "batch", batchId: "batch-1" }),
    ]);
    expect(duplicateInCall.status).toBe("rejected");
    if (duplicateInCall.status === "rejected") expect(duplicateInCall.code).toBe("CANDIDATE_AUDIT_DUPLICATE_IN_CALL");

    const mixedBatchIds = await audits.insertApprovalAudits([
      audit(first, { mode: "batch", batchId: "batch-1" }),
      audit(second, { mode: "batch", batchId: "batch-2" }),
    ]);
    expect(mixedBatchIds.status).toBe("rejected");
    if (mixedBatchIds.status === "rejected") expect(mixedBatchIds.code).toBe("CANDIDATE_AUDIT_BATCH_ID_INCONSISTENT");

    const mixedModes = await audits.insertApprovalAudits([
      audit(first, { mode: "batch", batchId: "batch-1" }),
      audit(second, { mode: "single", batchId: null }),
    ]);
    expect(mixedModes.status).toBe("rejected");
    if (mixedModes.status === "rejected") expect(mixedModes.code).toBe("CANDIDATE_AUDIT_BATCH_ID_INCONSISTENT");

    // None of the malformed calls wrote anything.
    expect(await audits.listApprovalAudits({})).toHaveLength(0);
  });

  it("keeps the foreign key: an audit cannot be attached to a candidate that does not exist", async () => {
    await seed();
    // The resolver exists because of this constraint; proving the constraint
    // keeps the two from drifting apart silently.
    await expect(
      client.query(
        `insert into lexicon_candidate_approvals
           (candidate_id, revision, mode, batch_id, approved_by, approved_at,
            document_kind, document_stable_key, document_version, segment_index)
         values (gen_random_uuid(), 1, 'single', null, 'x', now(), 'article', 'article.canary', 1, 0)`,
      ),
    ).rejects.toThrow(/lexicon_candidates/);
    expect(await audits.listApprovalAudits({})).toHaveLength(0);
  });

  it("treats an empty batch as a no-op and an unknown candidate as no records", async () => {
    expect(await audits.insertApprovalAudits([])).toEqual({ status: "recorded", inserted: 0, duplicates: 0 });
    expect(await audits.listApprovalAudits({ candidateId: "lexeme|article|article.canary|1|0|nadie" })).toEqual([]);
    // An id `makeCandidateId()` could not produce is not a lookup that can match.
    expect(await audits.listApprovalAudits({ candidateId: "not-a-candidate-id" })).toEqual([]);
  });

  it("orders reads by approval time across candidates", async () => {
    const first = await seed();
    const second = await seed({
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo", source: { ...candidate().source, segmentIndex: 1 },
    });

    await audits.insertApprovalAudit(audit(second, { approvedAt: later }));
    await audits.insertApprovalAudit(audit(first, { approvedAt: approvalTime }));

    const all = await audits.listApprovalAudits({});
    expect(all.map((record) => record.candidateId)).toEqual([first.candidate.id, second.candidate.id]);
    expect(all[0]?.approvedAt.toISOString()).toBe(approvalTime.toISOString());
    expect(all[1]?.approvedAt.toISOString()).toBe(later.toISOString());
  });
});
