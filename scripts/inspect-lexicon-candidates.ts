/**
 * Read-only: what do the stored candidates and their reviews actually say?
 *
 * Answers the question the canary raises but cannot show, because the review
 * seam carries only the verdict and not the vendor's prose.
 */
import { config as loadDotEnv } from "dotenv";
import { sql } from "drizzle-orm";

import { createDatabaseConnection } from "../src/shared/db/client";

loadDotEnv({ quiet: true });

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection configured");
  process.exit(1);
}

const { client, db } = createDatabaseConnection(connection);

try {
  const totals = await db.execute<{ status: string; n: number }>(sql`
    select status, count(*)::int as n from lexicon_candidates group by status order by status
  `);
  console.log("=== candidates by status ===");
  for (const row of totals) console.log(`  ${row.status.padEnd(18)} ${row.n}`);
  if (totals.length === 0) console.log("  (none stored)");

  const dimensions = await db.execute<{ dimension: string; outcome: string; n: number }>(sql`
    select review->>'dimension' as dimension, review->>'outcome' as outcome, count(*)::int as n
    from lexicon_candidates, jsonb_array_elements(reviews) as review
    group by 1, 2 order by 1, 2
  `);
  console.log("\n=== stored review verdicts by dimension ===");
  if (dimensions.length === 0) console.log("  (no reviews recorded)");
  for (const row of dimensions) console.log(`  ${String(row.dimension).padEnd(18)} ${row.outcome.padEnd(6)} ${row.n}`);

  const sample = await db.execute<{
    kind: string;
    surface: string;
    lemma: string | null;
    pos: string | null;
    meaning: string | null;
    status: string;
    reviews: unknown;
  }>(sql`
    select candidate_kind as kind, source_text as surface, lemma, part_of_speech as pos,
           meaning_zh as meaning, status, reviews
    from lexicon_candidates order by created_at desc limit 8
  `);
  console.log("\n=== most recent candidates (with their recorded reviews) ===");
  for (const row of sample) {
    console.log(`  [${row.kind}] ${row.surface} → lemma=${row.lemma} pos=${row.pos} zh=${row.meaning} status=${row.status}`);
    console.log(`      reviews: ${JSON.stringify(row.reviews).slice(0, 300)}`);
  }

  const approvedNeedingApprover = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from lexicon_candidates
    where status = 'approved' and (approved_by is null or approved_at is null)
  `);
  console.log(`\napproved rows missing an approver: ${approvedNeedingApprover[0]?.n ?? "?"} (must be 0)`);

  const auditRows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from lexicon_candidate_approvals
  `);
  console.log(`approval audit rows: ${auditRows[0]?.n ?? "?"}`);
} finally {
  await client.end({ timeout: 5 });
}
