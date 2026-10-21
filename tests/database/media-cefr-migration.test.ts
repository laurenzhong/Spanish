import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * Applies migration 0041 for real, on a throwaway in-process Postgres.
 *
 * The migration widens the media CEFR scale from A2/B1 to A1/A2/B1/B2 and has
 * never been applied to any database: applying it needs an empty-database or
 * clone rehearsal and a migration review first. Static review alone cannot
 * prove the generated ALTER runs, so this suite runs it without touching a real
 * database and then exercises the resulting constraint behaviourally.
 */

const drizzleDir = path.join(process.cwd(), "drizzle");

async function statementsOf(fileName: string): Promise<string[]> {
  const raw = await readFile(path.join(drizzleDir, fileName), "utf8");
  return raw
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function apply(db: PGlite, fileName: string): Promise<void> {
  for (const statement of await statementsOf(fileName)) {
    await db.exec(statement);
  }
}

async function cefrConstraint(db: PGlite): Promise<string> {
  const result = await db.query<{ definition: string }>(
    `select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'media_versions_cefr_check'`,
  );
  expect(result.rows).toHaveLength(1);
  return result.rows[0]!.definition;
}

/** The enum value the seeded license column needs; read it instead of guessing. */
async function anyLicense(db: PGlite): Promise<string> {
  const result = await db.query<{ value: string }>(
    `select enumlabel as value from pg_enum join pg_type on pg_type.oid = pg_enum.enumtypid where pg_type.typname = 'content_source_license' order by enumsortorder limit 1`,
  );
  expect(result.rows.length).toBeGreaterThan(0);
  return result.rows[0]!.value;
}

describe("migration 0041 widens the media CEFR scale", () => {
  it("ships in drizzle/ so the standard migration path can apply it", async () => {
    const journal = JSON.parse(await readFile(path.join(drizzleDir, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const entry = journal.entries.find((candidate) => candidate.tag === "0041_media_cefr_four_levels");
    expect(entry).toBeDefined();
    expect(entry!.idx).toBe(41);
    // The snapshot has to travel with the journal entry or the next generated
    // migration diffs against a stale baseline.
    const snapshot = JSON.parse(await readFile(path.join(drizzleDir, "meta", "0041_snapshot.json"), "utf8")) as {
      prevId: string;
      tables: Record<string, { checkConstraints: Record<string, { value: string }> }>;
    };
    expect(snapshot.tables["public.media_versions"]!.checkConstraints.media_versions_cefr_check!.value).toContain(
      "'A1', 'A2', 'B1', 'B2'",
    );
  });

  it("replaces the two-level constraint and accepts every level behaviourally", async () => {
    const db = new PGlite();
    try {
      // Supabase-shaped prerequisites the foundation migration expects: the
      // RLS roles and `auth.uid()` used by its policies.
      await db.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
      // The media library foundation creates media_versions with the old scale;
      // 0000 provides the enums it references.
      await apply(db, "0000_big_phalanx.sql");
      await apply(db, "0024_media_library_foundation.sql");

      const before = await cefrConstraint(db);
      expect(before).toContain("A2");
      expect(before).toContain("B1");
      expect(before).not.toContain("B2");

      await apply(db, "0041_media_cefr_four_levels.sql");

      const after = await cefrConstraint(db);
      for (const level of ["A1", "A2", "B1", "B2"]) expect(after).toContain(level);

      // Behavioural proof: clone the table's constraints and try real values.
      // Each probe needs its own media_item_id because the clone keeps the
      // (media_item_id, version) unique index.
      const license = await anyLicense(db);
      await db.exec(`create temp table cefr_probe (like media_versions including all)`);
      const insert = (level: string | null, suffix: string) => db.query(
        `insert into cefr_probe (media_item_id, version, title, source_name, duration_ms, content_hash, license, attribution, license_evidence, cefr)
         values ($3, 1, 't', 's', 1000, repeat('a', 64), $1, 'a', 'e', $2)`,
        [license, level, `00000000-0000-4000-8000-0000000000${suffix}`],
      );

      for (const [index, level] of ["A1", "A2", "B1", "B2"].entries()) {
        await expect(insert(level, `1${index}`)).resolves.toBeDefined();
      }
      await expect(insert("C1", "19")).rejects.toThrow(/media_versions_cefr_check/);
      // Null stays allowed: ungraded media is legitimate.
      await expect(insert(null, "1a")).resolves.toBeDefined();
    } finally {
      await db.close();
    }
  });
});
