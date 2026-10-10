/**
 * Read-only pre-flight check before applying migration 0042.
 *
 * Answers three questions and writes nothing:
 *   1. What does the database record as applied, and is the journal ahead of it?
 *   2. Can `0041_media_cefr_four_levels` apply safely — i.e. does any row still
 *      carry a `cefr` value outside the new four-level scale?
 *   3. Does the lexicon schema already exist, and is `media_versions` shaped as
 *      `0041` expects?
 *
 * Usage: node --conditions=react-server --import tsx/esm scripts/preflight-migration-0042.ts
 */
import { config as loadDotEnv } from "dotenv";
import postgres from "postgres";

loadDotEnv({ quiet: true });

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.log("no DATABASE_URL / DIRECT_DATABASE_URL configured");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 20 });

try {
  console.log("=== applied migrations (last 6) ===");
  const applied = await sql<{ hash: string; created_at: string }[]>`
    select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 6
  `;
  for (const row of applied) {
    console.log(`  ${new Date(Number(row.created_at)).toISOString()}  ${row.hash.slice(0, 12)}…`);
  }
  const [{ count: appliedCount }] = await sql<{ count: number }[]>`
    select count(*)::int as count from drizzle.__drizzle_migrations
  `;
  console.log(`  total applied: ${appliedCount}`);

  console.log("\n=== 0041 safety: cefr values currently present in media_versions ===");
  const cefr = await sql<{ cefr: string | null; n: number }[]>`
    select cefr, count(*)::int as n from media_versions group by cefr order by cefr nulls last
  `;
  for (const row of cefr) console.log(`  cefr=${row.cefr ?? "(null)"}  rows=${row.n}`);
  const offending = cefr.filter((row) => row.cefr !== null && !["A1", "A2", "B1", "B2"].includes(row.cefr));
  console.log(
    offending.length === 0
      ? "  -> 0041 can apply: every non-null cefr is already within A1/A2/B1/B2"
      : `  -> 0041 WOULD FAIL: out-of-range values ${offending.map((r) => r.cefr).join(", ")}`,
  );

  console.log("\n=== current media_versions_cefr_check definition (read-only) ===");
  const constraint = await sql<{ def: string }[]>`
    select pg_get_constraintdef(oid) as def from pg_constraint
    where conname = 'media_versions_cefr_check'
  `;
  console.log(`  ${constraint[0]?.def ?? "(constraint not found)"}`);

  console.log("\n=== lexicon tables: do 0042's targets already exist? ===");
  const tables = await sql<{ tablename: string }[]>`
    select tablename from pg_tables
    where schemaname = 'public' and tablename in
      ('lexicon_candidates', 'lexicon_candidate_approvals')
    order by tablename
  `;
  console.log(
    tables.length === 0
      ? "  neither exists -> 0042 would create both"
      : `  already present: ${tables.map((t) => t.tablename).join(", ")}`,
  );

  console.log("\n=== 0042 impact on existing data: none expected, confirming table counts ===");
  const [{ count: articles }] = await sql<{ count: number }[]>`select count(*)::int as count from articles`;
  const [{ count: media }] = await sql<{ count: number }[]>`select count(*)::int as count from media_versions`;
  console.log(`  articles=${articles}  media_versions=${media}`);
} finally {
  await sql.end({ timeout: 5 });
}
