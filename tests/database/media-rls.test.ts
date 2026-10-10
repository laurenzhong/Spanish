// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

describe("media RLS", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
    await database.exec(await migration("0000_big_phalanx.sql"));
    await database.exec(await migration("0024_media_library_foundation.sql"));
    await database.exec(await migration("0025_youtube_video_publication.sql"));
    await database.exec(await migration("0026_brief_toro.sql"));
    // 0027 adds the artwork columns the media repository reads.
    await database.exec(await migration("0027_pale_colossus.sql"));
    await database.exec("insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f1', 'a@example.test'), ('00000000-0000-4000-8000-0000000000f2', 'b@example.test'); insert into profiles (id) values ('00000000-0000-4000-8000-0000000000f1'), ('00000000-0000-4000-8000-0000000000f2'); insert into media_items (id, stable_key, kind, current_version) values ('10000000-0000-4000-8000-0000000000f1', 'media.fixture.rls', 'video', 1); insert into media_versions (id, media_item_id, version, title, source_name, duration_ms, content_hash, status, license, attribution, license_evidence, copyright_status) values ('20000000-0000-4000-8000-0000000000f1', '10000000-0000-4000-8000-0000000000f1', 1, 'RLS', 'Fixture', 60000, repeat('a', 64), 'published', 'licensed', 'Fixture', 'https://example.test/license', 'cleared'); insert into user_media_progress (user_id, media_version_id, last_position_ms) values ('00000000-0000-4000-8000-0000000000f1', '20000000-0000-4000-8000-0000000000f1', 1000), ('00000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000000f1', 2000); set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000f1', false);");
  });

  afterEach(async () => {
    await database.close();
  });

  it("exposes only owned progress and keeps formal media server-only", async () => {
    const rows = await database.query<{ user_id: string; last_position_ms: number }>("select user_id, last_position_ms from user_media_progress");
    expect(rows.rows).toEqual([{ user_id: "00000000-0000-4000-8000-0000000000f1", last_position_ms: 1_000 }]);
    await expect(database.exec("insert into user_media_progress (user_id, media_version_id) values ('00000000-0000-4000-8000-0000000000f2', '20000000-0000-4000-8000-0000000000f1')")).rejects.toThrow();
    await expect(database.query("select * from media_assets")).rejects.toThrow();
  });
});
