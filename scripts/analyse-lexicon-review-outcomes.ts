/**
 * Read-only: which extracted candidates pass the language review, and does the
 * outcome correlate with anything visible without the vendor's explanation?
 *
 * The canary showed `content-es-ES` passing roughly a quarter of lexemes. The
 * verdict alone cannot say why, but the *pattern* across part of speech, form
 * length and surface shape can rule hypotheses in or out before anyone reads a
 * single reason — and it needs no seam change.
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

type Row = {
  pos: string | null;
  outcome: string;
  n: number;
};

try {
  const byPos = await db.execute<Row>(sql`
    select c.part_of_speech as pos,
           review->>'outcome' as outcome,
           count(*)::int as n
    from lexicon_candidates c, jsonb_array_elements(c.reviews) as review
    where review->>'dimension' = 'content-es-ES'
    group by 1, 2
    order by 1 nulls last, 2
  `);

  console.log("=== content-es-ES outcome by part of speech ===");
  const grouped = new Map<string, { pass: number; fail: number }>();
  for (const row of byPos) {
    const key = row.pos ?? "(none claimed)";
    const entry = grouped.get(key) ?? { pass: 0, fail: 0 };
    if (row.outcome === "pass") entry.pass += row.n;
    else entry.fail += row.n;
    grouped.set(key, entry);
  }
  for (const [pos, entry] of [...grouped].sort()) {
    const total = entry.pass + entry.fail;
    const rate = total === 0 ? 0 : Math.round((entry.pass / total) * 100);
    console.log(`  ${pos.padEnd(16)} pass ${String(entry.pass).padStart(3)}  fail ${String(entry.fail).padStart(3)}  (${rate}% pass)`);
  }

  const byLength = await db.execute<{ bucket: string; outcome: string; n: number }>(sql`
    select case
             when length(c.source_text) <= 4 then '1-4'
             when length(c.source_text) <= 7 then '5-7'
             when length(c.source_text) <= 10 then '8-10'
             else '11+'
           end as bucket,
           review->>'outcome' as outcome,
           count(*)::int as n
    from lexicon_candidates c, jsonb_array_elements(c.reviews) as review
    where review->>'dimension' = 'content-es-ES'
    group by 1, 2
    order by 1
  `);
  console.log("\n=== outcome by surface-form length ===");
  const lengthGroups = new Map<string, { pass: number; fail: number }>();
  for (const row of byLength) {
    const entry = lengthGroups.get(row.bucket) ?? { pass: 0, fail: 0 };
    if (row.outcome === "pass") entry.pass += row.n;
    else entry.fail += row.n;
    lengthGroups.set(row.bucket, entry);
  }
  for (const [bucket, entry] of [...lengthGroups].sort()) {
    const total = entry.pass + entry.fail;
    const rate = total === 0 ? 0 : Math.round((entry.pass / total) * 100);
    console.log(`  ${bucket.padEnd(8)} pass ${String(entry.pass).padStart(3)}  fail ${String(entry.fail).padStart(3)}  (${rate}% pass)`);
  }

  const failures = await db.execute<{ surface: string; lemma: string | null; pos: string | null; reason: string | null }>(sql`
    select c.source_text as surface, c.lemma, c.part_of_speech as pos,
           review->>'reason' as reason
    from lexicon_candidates c, jsonb_array_elements(c.reviews) as review
    where review->>'dimension' = 'content-es-ES' and review->>'outcome' = 'fail'
    order by c.created_at desc limit 25
  `);
  console.log("\n=== recent content-es-ES failures ===");
  for (const row of failures) console.log(`  ${row.surface.padEnd(18)} lemma=${String(row.lemma).padEnd(16)} pos=${row.pos}`);

  const passes = await db.execute<{ surface: string; lemma: string | null; pos: string | null }>(sql`
    select c.source_text as surface, c.lemma, c.part_of_speech as pos
    from lexicon_candidates c, jsonb_array_elements(c.reviews) as review
    where review->>'dimension' = 'content-es-ES' and review->>'outcome' = 'pass'
    order by c.created_at desc limit 25
  `);
  console.log("\n=== content-es-ES passes (for contrast) ===");
  for (const row of passes) console.log(`  ${row.surface.padEnd(18)} lemma=${String(row.lemma).padEnd(16)} pos=${row.pos}`);

  // ---------------------------------------------------------------- the reasons
  // Only rows written after the reason field landed carry one; everything before
  // it is structurally four-key. The count is printed so an empty section is
  // never mistaken for "no rejections".
  const withReason = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from lexicon_candidates c, jsonb_array_elements(c.reviews) as review
    where review ? 'reason'
  `);
  console.log(`\n=== stored reviews carrying a reason: ${withReason[0]?.n ?? 0} ===`);

  const reasons = await db.execute<{ surface: string; outcome: string; reason: string }>(sql`
    select c.source_text as surface, review->>'outcome' as outcome, review->>'reason' as reason
    from lexicon_candidates c, jsonb_array_elements(c.reviews) as review
    where review->>'dimension' = 'content-es-ES' and review ? 'reason'
    order by c.created_at desc limit 20
  `);
  for (const row of reasons) {
    console.log(`\n  [${row.outcome}] ${row.surface}`);
    console.log(`    ${row.reason.slice(0, 700)}`);
  }
} finally {
  await client.end({ timeout: 5 });
}
