/**
 * Exercises the Drizzle candidate repository against the real database.
 *
 * Why this exists: the repository was written and type-checked but, because its
 * migration had never been applied, its `.set()` shape, its conflict target and
 * its jsonb round-trip had never executed a single query. It was reported as
 * unverified, and this closes that gap now that the tables exist.
 *
 * Everything runs inside one transaction that is rolled back at the end, so the
 * database is left exactly as found: no real candidates, no touched rows.
 *
 * Run: node --conditions=react-server --import tsx/esm scripts/verify-drizzle-candidate-repository.ts
 */
import { config as loadDotEnv } from "dotenv";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "../src/shared/db/client";
import { makeCandidateId, type LexiconCandidate } from "../src/modules/lexicon-corpus/domain/lexicon-candidate";
import { createDrizzleLexiconCandidateRepository } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-repository";
import type { LexiconCandidateRecord } from "../src/modules/lexicon-corpus/repositories/lexicon-candidate-repository";

loadDotEnv({ quiet: true });

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection string configured");
  process.exit(1);
}

const { client, db } = createDatabaseConnection(connection);

const results: string[] = [];
const check = (label: string, passed: boolean, detail = ""): void => {
  results.push(`${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

const KEY = "verify.drizzle.repo";
const now = new Date();
const provenance = { provider: "verify", modelVersion: "verify-v1", confidence: 97 } as const;

function record(overrides: Partial<LexiconCandidate> = {}): LexiconCandidateRecord {
  const candidate: Omit<LexiconCandidate, "id"> = {
    kind: "lexeme",
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    meaningZh: null,
    status: "discovered",
    revision: 1,
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
    reviews: [],
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  return {
    candidate: {
      ...candidate,
      id: makeCandidateId({
        kind: candidate.kind,
        documentKind: candidate.source.documentKind,
        stableKey: candidate.source.documentStableKey,
        version: candidate.source.documentVersion,
        segmentIndex: candidate.source.segmentIndex,
        normalizedText: candidate.normalizedText,
      }),
    },
    provenance,
  };
}

const SOURCE = { documentKind: "article" as const, documentStableKey: KEY, documentVersion: 1 };

try {
  // --- the foreign key Postgres warned it had to truncate -------------------
  const fk = await db.execute<{ conname: string; def: string }>(sql`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'lexicon_candidate_approvals'::regclass and contype = 'f'
  `);
  const fkRow = fk[0];
  check("approval table has its foreign key", Boolean(fkRow), fkRow?.conname ?? "missing");
  if (fkRow) {
    check(
      "foreign key is correct despite the truncated name",
      fkRow.def.includes("REFERENCES lexicon_candidates"),
      fkRow.def.slice(0, 100),
    );
  }

  // A rollback is signalled by throwing, so it must be the last statement and
  // the thrown signal has to be caught outside.
  await db
    .transaction(async (tx) => {
      const repository = createDrizzleLexiconCandidateRepository(tx as never);

      const created = await repository.create(record());
      check("create inserts a candidate", created.status === "created", created.status);

      const again = await repository.create(record());
      check(
        "a repeated create returns the existing row rather than a second one",
        again.status === "exists",
        again.status,
      );

      const stored = created.status === "created" ? created.record : null;
      const found = stored ? await repository.findById(stored.candidate.id) : null;
      check("findById resolves the derived id", found?.candidate.id === stored?.candidate.id);
      check(
        "jsonb reviews round-trips as an array",
        Array.isArray(found?.candidate.reviews),
        JSON.stringify(found?.candidate.reviews),
      );
      check(
        "timestamps decode back to Date, not strings",
        found?.candidate.createdAt instanceof Date,
        String(found?.candidate.createdAt),
      );
      check("provenance survives the round-trip", found?.provenance.provider === "verify");

      const advanced = record({ revision: 2, status: "review_submitted", reviews: [] });
      const saved = await repository.save({ candidate: advanced.candidate, expectedRevision: 1 });
      check("CAS accepts a write whose expectedRevision matches", saved.status === "saved", saved.status);

      const stale = await repository.save({ candidate: advanced.candidate, expectedRevision: 1 });
      check(
        "CAS refuses a stale write",
        stale.status === "conflict",
        stale.status === "conflict" ? `actualRevision=${stale.actualRevision}` : stale.status,
      );
      if (stale.status === "conflict") {
        check("conflict reports the stored revision", stale.actualRevision === 2, String(stale.actualRevision));
        check("conflict returns the current record so the caller can rebase", Boolean(stale.current));
      }

      const indexable = await repository.listIndexable(SOURCE);
      check(
        "listIndexable excludes a review_submitted candidate",
        indexable.length === 0,
        `returned ${indexable.length}`,
      );

      const unaudited = await repository.save({
        candidate: record({ revision: 3, status: "approved", approvedBy: null, approvedAt: null }).candidate,
        expectedRevision: 2,
      });
      check(
        "an approved candidate with no approver never reaches the database",
        unaudited.status !== "saved",
        unaudited.status,
      );

      tx.rollback();
    })
    .catch((cause: unknown) => {
      // Rolling back is the expected end of this transaction, not a failure.
      const name = (cause as { name?: string })?.name ?? "";
      const constructor = (cause as { constructor?: { name?: string } })?.constructor?.name ?? "";
      if (!/rollback/i.test(`${name}${constructor}`)) {
        check("transaction rolled back cleanly", false, `${constructor}: ${String(cause).slice(0, 160)}`);
      }
    });
} catch (error) {
  check("verification ran to completion", false, String(error).slice(0, 300));
} finally {
  for (const line of results) console.log(line);
  const failures = results.filter((line) => line.startsWith("FAIL")).length;
  console.log(`\n${results.length - failures}/${results.length} checks passed`);

  const leftover = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from lexicon_candidates where document_stable_key = ${KEY}
  `);
  const rows = leftover[0]?.n ?? -1;
  console.log(`rows left behind by this run: ${rows} ${rows === 0 ? "(clean)" : "(LEAK!)"}`);

  await client.end({ timeout: 5 });
  process.exitCode = failures === 0 && rows === 0 ? 0 : 1;
}
