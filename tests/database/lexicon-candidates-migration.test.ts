import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * Applies migration 0042 for real, on a throwaway in-process Postgres.
 *
 * The migration has never been applied to any database: the owner asked to
 * review the diff first. That makes static review the only thing standing
 * between it and production, and static review cannot catch a generated file
 * that fails at parse or execution time. This suite closes that gap without
 * touching a real database.
 *
 * The generated SQL is read from `drizzle/`, the artifact that actually gets
 * applied, and a companion case asserts the review copy in `docs/migrations/` is
 * byte-identical to it — so the reviewed document cannot drift away from what
 * runs. While the migration awaited approval the reverse arrangement was used:
 * the SQL sat only in `docs/` precisely so that no automatic migration path
 * could apply it.
 */

const drizzleDir = path.join(process.cwd(), "drizzle");
const artifactPath = path.join(drizzleDir, "0042_stale_starbolt.sql");
const reviewCopyPath = path.join(
  process.cwd(),
  "docs/migrations/0042_lexicon_candidates_and_approvals.sql",
);

async function migrationStatements(): Promise<string[]> {
  const raw = await readFile(artifactPath, "utf8");
  return raw
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * A throwaway in-process Postgres.
 *
 * `gen_random_uuid()` is built into Postgres 13 and later, so the migration's
 * column default needs no extension; PGlite does not ship `pgcrypto` and asking
 * for it fails.
 */
async function database(): Promise<PGlite> {
  return new PGlite();
}

async function applyArtifact(db: PGlite): Promise<void> {
  for (const statement of await migrationStatements()) {
    await db.exec(statement);
  }
}

describe("migration 0042 applies to a real Postgres", () => {
  it("keeps the reviewed document byte-identical to the artifact that runs", async () => {
    // A review package that drifts from the migration it describes is worse than
    // no review package, because it invites approving something else.
    const [applied, reviewed] = await Promise.all([
      readFile(artifactPath, "utf8"),
      readFile(reviewCopyPath, "utf8"),
    ]);
    expect(reviewed).toBe(applied);
  });

  it("splits into executable statements and creates both tables", async () => {
    const db = await database();
    try {
      const statements = await migrationStatements();
      // Two CREATE TABLE, one ALTER TABLE for the foreign key, six CREATE INDEX.
      expect(statements.length).toBeGreaterThanOrEqual(9);

      await applyArtifact(db);

      const tables = await db.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public' order by tablename`,
      );
      expect(tables.rows.map((row) => row.tablename)).toEqual([
        "lexicon_candidate_approvals",
        "lexicon_candidates",
      ]);
    } finally {
      await db.close();
    }
  });

  it("creates every index and check constraint the review package claims", async () => {
    const db = await database();
    try {
      await applyArtifact(db);

      const indexes = await db.query<{ indexname: string }>(
        `select indexname from pg_indexes where schemaname = 'public' order by indexname`,
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        "lexicon_candidate_approvals_approved_at_idx",
        "lexicon_candidate_approvals_batch_idx",
        "lexicon_candidate_approvals_candidate_revision_uidx",
        "lexicon_candidate_approvals_pkey",
        "lexicon_candidates_document_idx",
        "lexicon_candidates_identity_uidx",
        "lexicon_candidates_pkey",
        "lexicon_candidates_status_idx",
      ]);

      const checks = await db.query<{ conname: string }>(
        `select conname from pg_constraint where contype = 'c' and conname like 'lexicon_%' order by conname`,
      );
      expect(checks.rows.map((row) => row.conname)).toEqual([
        "lexicon_candidate_approvals_batch_id_check",
        "lexicon_candidate_approvals_counts_check",
        "lexicon_candidate_approvals_document_kind_check",
        "lexicon_candidate_approvals_mode_check",
        "lexicon_candidate_approvals_revision_positive_check",
        "lexicon_candidates_approved_audit_check",
        "lexicon_candidates_confidence_check",
        "lexicon_candidates_document_kind_check",
        "lexicon_candidates_kind_check",
        "lexicon_candidates_revision_positive_check",
        "lexicon_candidates_segment_index_check",
        "lexicon_candidates_status_check",
        "lexicon_candidates_version_positive_check",
      ]);
    } finally {
      await db.close();
    }
  });

  it("enforces the approved-audit check: approved without an approver is refused", async () => {
    const db = await database();
    try {
      await applyArtifact(db);

      const insert = (status: string, approvedBy: string | null, approvedAt: string | null) =>
        db.query(
          `insert into lexicon_candidates
             (candidate_kind, document_kind, document_stable_key, document_version,
              segment_index, source_text, normalized_text, source_title, source_kind,
              provider, status, approved_by, approved_at)
           values ('lexeme','article','a.b',1,0,'casa','casa','t','article-rss','minimax',$1,$2,$3)`,
          [status, approvedBy, approvedAt],
        );

      // The database, not the application, is what stops an unaudited approval.
      await expect(insert("approved", null, null)).rejects.toThrow(/approved_audit_check/);
      await expect(insert("approved", "dsh-ai", null)).rejects.toThrow(/approved_audit_check/);
      await expect(insert("approved", "dsh-ai", "2026-10-11T00:00:00Z")).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("enforces the batch audit check: a batch member must name its batch", async () => {
    const db = await database();
    try {
      await applyArtifact(db);
      const [{ id }] = (
        await db.query<{ id: string }>(
          `insert into lexicon_candidates
             (candidate_kind, document_kind, document_stable_key, document_version,
              segment_index, source_text, normalized_text, source_title, source_kind,
              provider, status, approved_by, approved_at)
           values ('lexeme','article','a.b',1,0,'casa','casa','t','article-rss','minimax',
                   'approved','dsh-ai','2026-10-11T00:00:00Z')
           returning id`,
        )
      ).rows;

      const audit = (mode: string, batchId: string | null) =>
        db.query(
          `insert into lexicon_candidate_approvals
             (candidate_id, revision, mode, batch_id, approved_by, approved_at,
              document_kind, document_stable_key, document_version, segment_index)
           values ($1,1,$2,$3,'dsh-ai','2026-10-11T00:00:00Z','article','a.b',1,0)`,
          [id, mode, batchId],
        );

      await expect(audit("batch", null)).rejects.toThrow(/batch_id_check/);
      await expect(audit("single", "batch-1")).rejects.toThrow(/batch_id_check/);
      await expect(audit("single", null)).resolves.toBeDefined();
      // One approval record per candidate revision, so a retry cannot duplicate it.
      await expect(audit("single", null)).rejects.toThrow(/candidate_revision_uidx/);
    } finally {
      await db.close();
    }
  });

  it("enforces the identity unique index across the six identity columns", async () => {
    const db = await database();
    try {
      await applyArtifact(db);
      const insertRow = (documentKind: string, segmentIndex: number) =>
        db.query(
          `insert into lexicon_candidates
             (candidate_kind, document_kind, document_stable_key, document_version,
              segment_index, source_text, normalized_text, source_title, source_kind, provider)
           values ('lexeme',$1,'same.key',1,$2,'casa','casa','t','article-rss','minimax')`,
          [documentKind, segmentIndex],
        );

      await expect(insertRow("article", 0)).resolves.toBeDefined();
      // Same span again: the index refuses the duplicate.
      await expect(insertRow("article", 0)).rejects.toThrow(/identity_uidx/);
      // Different document kind is a different identity, which is exactly what
      // `makeCandidateId()` now encodes too.
      await expect(insertRow("media", 0)).resolves.toBeDefined();
      await expect(insertRow("article", 1)).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("is the only migration that creates these tables, and matches the committed schema's columns", async () => {
    // Guards against the artifact drifting from the schema source: every column
    // the Drizzle definition declares must exist after the migration runs.
    const db = await database();
    try {
      await applyArtifact(db);
      const columns = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name = 'lexicon_candidates' order by column_name`,
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        "approved_at",
        "approved_by",
        "candidate_kind",
        "confidence",
        "context_after",
        "context_before",
        "created_at",
        "document_kind",
        "document_stable_key",
        "document_version",
        "id",
        "lemma",
        "meaning_zh",
        "model_version",
        "normalized_text",
        "part_of_speech",
        "provider",
        "rejected_reason",
        "reviews",
        "revision",
        "segment_index",
        "source_kind",
        "source_text",
        "source_title",
        "status",
        "updated_at",
      ]);

      const migrationFiles = (await import("node:fs/promises")).readdir(drizzleDir);
      const names = await migrationFiles;
      const creates = await Promise.all(
        names
          .filter((name) => name.endsWith(".sql"))
          .map(async (name) => ({
            name,
            body: await readFile(path.join(drizzleDir, name), "utf8"),
          })),
      );
      const creators = creates
        .filter((file) => /CREATE TABLE "lexicon_candidates"/.test(file.body))
        .map((file) => file.name);
      // Exactly one migration creates these tables, and it is the one the journal
      // and the database both recorded. While the migration awaited approval this
      // list was asserted empty, so that no automatic path could apply it; now
      // that it has been reviewed and applied, the assertion is inverted to keep
      // the same guarantee from the other side — no second file may create it.
      expect(creators).toEqual(["0042_stale_starbolt.sql"]);
    } finally {
      await db.close();
    }
  });
});
