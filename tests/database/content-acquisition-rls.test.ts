// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const internalTables = [
  "acquisition_sources",
  "acquisition_runs",
  "content_candidates",
  "candidate_artifacts",
  "candidate_processing_attempts",
  "candidate_reviews",
] as const;

async function acquisitionMigration(): Promise<string> {
  const names = (await readdir(path.join(process.cwd(), "drizzle")))
    .filter((name) => /^0021_.+\.sql$/u.test(name));
  expect(names).toHaveLength(1);
  return (await readFile(path.join(process.cwd(), "drizzle", names[0]!), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

describe("content acquisition RLS", () => {
  let client: PGlite;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(`
      create role anon nologin;
      create role authenticated nologin;
      grant usage on schema public to anon, authenticated;
    `);
    await client.exec(await acquisitionMigration());
  });

  afterEach(async () => {
    await client.close();
  });

  it("enables row-level security on every internal workflow table", async () => {
    const result = await client.query<{ relname: string; relrowsecurity: boolean }>(`
      select relname, relrowsecurity
      from pg_class
      where relname = any(array[${internalTables.map((table) => `'${table}'`).join(", ")}])
      order by relname
    `);
    expect(result.rows).toHaveLength(internalTables.length);
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("gives browser roles no direct read or write privilege on internal workflow tables", async () => {
    for (const table of internalTables) {
      for (const role of ["anon", "authenticated"] as const) {
        for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"] as const) {
          const result = await client.query<{ allowed: boolean }>(
            `select has_table_privilege('${role}', '${table}', '${privilege}') as allowed`,
          );
          expect(result.rows[0]?.allowed, `${role} must not ${privilege} ${table}`).toBe(false);
        }
      }
    }
  });

  it("rejects browser writes while allowing the service-side table owner", async () => {
    await client.exec(`
      insert into acquisition_sources (
        stable_key, adapter_type, source_kind, external_source_id,
        display_name, language, enabled, rights_status
      ) values (
        'service.fixture', 'fake', 'video-channel', 'service-channel',
        'Service fixture', 'es', true, 'verified'
      );
      set role authenticated;
    `);
    await expect(client.exec(`
      insert into acquisition_sources (
        stable_key, adapter_type, source_kind, external_source_id,
        display_name, language, enabled, rights_status
      ) values (
        'browser.attack', 'fake', 'video-channel', 'browser-channel',
        'Browser attack', 'es', true, 'verified'
      );
    `)).rejects.toThrow();
  });
});
