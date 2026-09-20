// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const userA = "00000000-0000-0000-0000-0000000000a1";
const userB = "00000000-0000-0000-0000-0000000000b1";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

describe("lexicon RLS", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
    await database.exec(await migration("0000_big_phalanx.sql"));
    await database.exec(await migration("0021_shallow_killmonger.sql"));
    await database.exec(await migration("0037_migration_reconcile.sql"));
    await database.exec(`insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test'); insert into profiles (id) values ('${userA}'), ('${userB}'); insert into phrase_entries (id, expression, normalized_expression, owner_user_id, review_status) values ('10000000-0000-0000-0000-000000000001', 'privada', 'privada', '${userA}', 'pending'), ('20000000-0000-0000-0000-000000000002', 'pública', 'publica', null, 'approved'); set role authenticated; select set_config('request.jwt.claim.sub', '${userA}', false);`);
  });

  afterEach(async () => { await database.close(); });

  it("shows only approved public and current-user private phrases", async () => {
    const own = await database.query<{ expression: string }>("select expression from phrase_entries order by expression");
    expect(own.rows.map((row) => row.expression)).toEqual(["privada", "pública"]);
    await database.exec(`select set_config('request.jwt.claim.sub', '${userB}', false);`);
    const other = await database.query<{ expression: string }>("select expression from phrase_entries order by expression");
    expect(other.rows.map((row) => row.expression)).toEqual(["pública"]);
  });

  it("prevents anonymous writes and cross-user intent writes", async () => {
    await expect(database.exec("set role anon; insert into phrase_entries (expression, normalized_expression) values ('x', 'x')")).rejects.toThrow();
    await database.exec("set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);");
    await expect(database.exec(`insert into user_lexical_intents (user_id, entry_kind, entry_id, intent) values ('${userB}', 'phrase', '20000000-0000-0000-0000-000000000002', 'revisit')`)).rejects.toThrow();
  });
});
