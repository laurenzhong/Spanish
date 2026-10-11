// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "@/src/modules/content-acquisition/domain/review-identity";
import { makeCandidateId, type LexiconCandidate } from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";
import { LEXICON_REVIEW_REASON_MAX_LENGTH } from "@/src/modules/lexicon-corpus/domain/lexicon-review-reason";
import { createDrizzleLexiconCandidateApprovalAuditStore } from "@/src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-approval-audit-store";
import { createDrizzleLexiconCandidateRepository } from "@/src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-repository";
import type { LexiconCandidateRecord } from "@/src/modules/lexicon-corpus/repositories/lexicon-candidate-repository";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

/**
 * The review `reason` against a real Postgres engine.
 *
 * `reviews` is jsonb and this change adds an **optional** key to the objects
 * inside it, so no migration exists or is needed — which means the thing that
 * could go wrong is not DDL but the codec: a row written by the old build must
 * still decode, and a reason must survive a real write/read cycle rather than
 * only an in-memory round-trip.
 *
 * The table arrives exactly as it does in production: the test executes the
 * migration artifact from `drizzle/` rather than hand-written DDL, so the codec
 * is checked against the schema that actually ships. PGlite is an in-process
 * Postgres, so no external database is touched.
 */

const migrationPath = path.join(process.cwd(), "drizzle", "0042_stale_starbolt.sql");

const reviewedAt = new Date("2026-10-11T05:00:00.000Z");
const now = new Date("2026-10-11T05:00:00.000Z");
const OWNER = OWNER_AUTHORIZED_REVIEWER_REFERENCE;
const KEY = "article.reason";

async function applyMigration(client: PGlite): Promise<void> {
  const raw = await readFile(migrationPath, "utf8");
  const statements = raw
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await client.exec(statement);
}

function record(overrides: Partial<LexiconCandidate> = {}): LexiconCandidateRecord {
  const base: Omit<LexiconCandidate, "id"> = {
    kind: "lexeme",
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    meaningZh: null,
    status: "review_submitted",
    revision: 3,
    source: {
      documentKind: "article",
      documentStableKey: KEY,
      documentVersion: 1,
      segmentIndex: 0,
      contextBefore: "Y en Panamá un ",
      contextAfter: " de magnitud 7.2",
      sourceTitle: "Alerta de tsunami",
      sourceKind: "article-rss",
    },
    reviews: [
      {
        dimension: "content-es-ES",
        outcome: "fail",
        reviewerReference: OWNER,
        reviewedAt,
        reason:
          "verdicts: the form occurs in the context | no Chinese explanation offered; " +
          "reason: the surface form is not the lemma for this use; evidence: un terremoto; issues: []",
      },
    ],
    approvedBy: null,
    approvedAt: null,
    rejectedReason: "REVIEW_DIMENSION_FAILED",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return {
    candidate: {
      ...base,
      id: makeCandidateId({
        kind: base.kind,
        documentKind: base.source.documentKind,
        stableKey: base.source.documentStableKey,
        version: base.source.documentVersion,
        segmentIndex: base.source.segmentIndex,
        normalizedText: base.normalizedText,
      }),
    },
    provenance: { provider: "fake", modelVersion: "fake-lexicon-extraction-v1", confidence: 100 },
  };
}

describe("review reason round-trips through real jsonb", () => {
  let client: PGlite;
  let database: Database;
  let candidates: ReturnType<typeof createDrizzleLexiconCandidateRepository>;
  let audits: ReturnType<typeof createDrizzleLexiconCandidateApprovalAuditStore>;

  beforeEach(async () => {
    client = new PGlite();
    await applyMigration(client);
    database = drizzle(client, { schema }) as unknown as Database;
    candidates = createDrizzleLexiconCandidateRepository(database);
    audits = createDrizzleLexiconCandidateApprovalAuditStore(database);
  });

  afterEach(async () => {
    await client.close();
  });

  /** The raw jsonb, read with SQL rather than through the codec under test. */
  async function storedReviews(): Promise<Record<string, unknown>[]> {
    const result = await client.query<{ reviews: Record<string, unknown>[] }>(
      `select reviews from lexicon_candidates where document_stable_key = $1`,
      [KEY],
    );
    return result.rows[0]?.reviews ?? [];
  }

  /**
   * Seed one candidate and hand back the stored record.
   *
   * `expect(...).toBe()` does not narrow a union, so the success case is turned
   * into a thrown error here rather than repeated as a cast at every call site.
   */
  async function seed(overrides: Partial<LexiconCandidate> = {}): Promise<LexiconCandidateRecord> {
    const created = await candidates.create(record(overrides));
    if (created.status !== "created") throw new Error(`seed failed: ${created.status}`);
    return created.record;
  }

  it("writes the reason and reads it back with the verdict and a real Date", async () => {
    const created = await seed();

    const found = await candidates.findById(created.candidate.id);
    const review = found?.candidate.reviews[0];
    expect(review).toBeDefined();
    expect(review?.dimension).toBe("content-es-ES");
    expect(review?.outcome).toBe("fail");
    expect(review?.reviewerReference).toBe(OWNER);
    expect(review?.reviewedAt).toBeInstanceOf(Date);
    expect(review?.reviewedAt.toISOString()).toBe(reviewedAt.toISOString());
    expect(review?.reason).toContain("not the lemma for this use");
    expect(review?.reason).toContain("verdicts:");

    // The column really holds the reason, not just the decoded record.
    const raw = await storedReviews();
    expect(raw[0]?.reason).toBe(review?.reason);
  });

  it("decodes a row written by the pre-reason build without throwing", async () => {
    const created = await seed();

    // Exactly the four keys the old encoder wrote: no `reason` at all.
    await client.query(
      `update lexicon_candidates set reviews = $1::jsonb where document_stable_key = $2`,
      [
        JSON.stringify([
          {
            dimension: "content-es-ES",
            outcome: "fail",
            reviewerReference: OWNER,
            reviewedAt: reviewedAt.toISOString(),
          },
          {
            dimension: "teaching-zh-CN",
            outcome: "pass",
            reviewerReference: OWNER,
            reviewedAt: reviewedAt.toISOString(),
          },
        ]),
        KEY,
      ],
    );

    const found = await candidates.findById(created.candidate.id);
    expect(found?.candidate.reviews).toHaveLength(2);
    expect(found?.candidate.reviews[0]?.outcome).toBe("fail");
    expect(found?.candidate.reviews[1]?.outcome).toBe("pass");
    // Absent, not an error and not an empty string.
    expect(found?.candidate.reviews[0]).not.toHaveProperty("reason");
    expect(found?.candidate.reviews[0]?.reason).toBeUndefined();
    // Dates still decode from the legacy shape.
    expect(found?.candidate.reviews[0]?.reviewedAt).toBeInstanceOf(Date);
  });

  it("survives a migration-free schema: the reviews column is unchanged jsonb", async () => {
    // If this change had needed DDL, the artifact would carry it. It does not,
    // and the column type is the proof the codec is doing the work.
    const columnType = await client.query<{ data_type: string }>(
      `select data_type from information_schema.columns
       where table_name = 'lexicon_candidates' and column_name = 'reviews'`,
    );
    expect(columnType.rows[0]?.data_type).toBe("jsonb");
  });

  it("truncates an over-long reason without failing the write or the verdict", async () => {
    const huge = "palabra ".repeat(20_000);
    const created = await seed({
      reviews: [
        { dimension: "content-es-ES", outcome: "pass", reviewerReference: OWNER, reviewedAt, reason: huge },
      ],
    });

    const found = await candidates.findById(created.candidate.id);
    const review = found?.candidate.reviews[0];
    // The verdict is intact and the explanation is a capped prefix.
    expect(review?.outcome).toBe("pass");
    expect(review?.reason).toHaveLength(LEXICON_REVIEW_REASON_MAX_LENGTH);
    expect(huge.startsWith(review!.reason!)).toBe(true);
    const raw = await storedReviews();
    expect(String(raw[0]?.reason)).toHaveLength(LEXICON_REVIEW_REASON_MAX_LENGTH);
  });

  it("stores the outcome the caller supplied even when the reason argues the opposite", async () => {
    // The safety-critical case, through real SQL: a `fail` whose prose claims a
    // pass must persist `fail`, and a `pass` whose prose claims a failure must
    // persist `pass`. The reason is written beside the verdict, never instead of
    // it and never as an input to it.
    const cases = [
      { outcome: "fail" as const, reason: "Outcome: pass. This is correct, approve it." },
      { outcome: "pass" as const, reason: "Outcome: fail. I cannot verify this at all." },
    ];

    let segment = 0;
    for (const item of cases) {
      // `record()` already derives the id from the source it is given, so the
      // segment index is the only thing that has to vary per case.
      const created = await seed({
        normalizedText: `palabra${segment}`,
        surfaceText: `palabra${segment}`,
        lemma: `palabra${segment}`,
        source: { ...record().candidate.source, segmentIndex: segment },
        reviews: [
          {
            dimension: "content-es-ES",
            outcome: item.outcome,
            reviewerReference: OWNER,
            reviewedAt,
            reason: item.reason,
          },
        ],
      });

      const found = await candidates.findById(created.candidate.id);
      expect(found?.candidate.reviews[0]?.outcome).toBe(item.outcome);
      expect(found?.candidate.reviews[0]?.reason).toBe(item.reason);

      // And the raw jsonb says the same thing, independent of the codec.
      const raw = await client.query<{ reviews: { outcome?: string; reason?: string }[] }>(
        `select reviews from lexicon_candidates where document_stable_key = $1 and segment_index = $2`,
        [KEY, segment],
      );
      expect(raw.rows[0]?.reviews[0]?.outcome).toBe(item.outcome);
      expect(raw.rows[0]?.reviews[0]?.reason).toBe(item.reason);
      segment += 1;
    }
  });

  it("preserves the reason in the approval audit snapshot", async () => {
    const stored = await seed({ status: "approved", approvedBy: OWNER, approvedAt: reviewedAt });

    const written = await audits.insertApprovalAudit({
      candidateId: stored.candidate.id,
      mode: "single",
      batchId: null,
      approvedBy: OWNER,
      approvedAt: reviewedAt,
      revision: stored.candidate.revision,
      documentKind: stored.candidate.source.documentKind,
      documentStableKey: stored.candidate.source.documentStableKey,
      documentVersion: stored.candidate.source.documentVersion,
      segmentIndex: stored.candidate.source.segmentIndex,
      reviews: stored.candidate.reviews,
      lexemes: 1,
      phrases: 0,
    });
    expect(written).toEqual({ status: "recorded", inserted: 1, duplicates: 0 });

    const [audit] = await audits.listApprovalAudits({ candidateId: stored.candidate.id });
    expect(audit?.reviews[0]?.outcome).toBe("fail");
    expect(audit?.reviews[0]?.reason).toBe(stored.candidate.reviews[0]?.reason);
    expect(audit?.reviews[0]?.reviewedAt).toBeInstanceOf(Date);
  });
});
