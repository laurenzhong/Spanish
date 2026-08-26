// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const userA = "00000000-0000-4000-8000-0000000000c1";
const userB = "00000000-0000-4000-8000-0000000000d1";
const articleId = "10000000-0000-4000-8000-0000000000c1";
const sourceId = "20000000-0000-4000-8000-0000000000c1";
const versionId = "30000000-0000-4000-8000-0000000000c1";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

describe("reading RLS", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    for (const name of [
      "0000_big_phalanx.sql",
      "0001_auth_rls.sql",
      "0002_content_import_registry.sql",
      "0003_chunky_black_knight.sql",
      "0004_calm_iron_monger.sql",
      "0005_kind_character_network.sql",
      "0006_opposite_centennial.sql",
      "0007_spicy_talkback.sql",
      "0008_broad_chronomancer.sql",
      "0009_oval_namora.sql",
      "0010_watery_ogun.sql",
      "0011_early_colleen_wing.sql",
      "0012_wakeful_spiral.sql",
    ]) await database.exec(await migration(name));
    await database.exec(`
      insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test');
      insert into article_sources (id, source_type, source_name, license, copyright_status) values ('${sourceId}', 'original', 'Sueño', 'original', 'cleared');
      insert into articles (id, stable_key) values ('${articleId}', 'article.rls-test');
      insert into article_versions (
        id, article_id, source_id, version, locale, title, summary, content_hash,
        cefr_level, topics, region, register, format, estimated_reading_minutes,
        assets, related_expression_keys, related_goal_keys, related_tag_keys,
        oral_transfer_type, status
      ) values (
        '${versionId}', '${articleId}', '${sourceId}', 1, 'es-ES', 'RLS', 'RLS', repeat('a', 64),
        'A2', '[]', 'es-ES', 'neutral', 'story', 3, '[]', '[]', '[]', '[]', 'summary', 'published'
      );
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${userA}', false);
    `);
  });

  afterEach(async () => {
    await database.close();
  });

  it("allows the current user and hides or rejects another user's reading rows", async () => {
    await database.exec(`
      insert into user_reading_progress (user_id, article_version_id, content_hash, position, note)
      values ('${userA}', '${versionId}', repeat('a', 64), 1, 'private');
      insert into user_saved_article_sources (user_id, source_url, normalized_url, title)
      values ('${userA}', 'https://example.com/a', 'https://example.com/a', 'Private source');
    `);
    const own = await database.query<{ user_id: string }>(`select user_id from user_reading_progress`);
    const hidden = await database.query<{ user_id: string }>(`select user_id from user_reading_progress where user_id = '${userB}'`);
    expect(own.rows).toEqual([{ user_id: userA }]);
    expect(hidden.rows).toEqual([]);
    await expect(database.exec(`
      insert into user_reading_progress (user_id, article_version_id, content_hash)
      values ('${userB}', '${versionId}', repeat('a', 64));
    `)).rejects.toThrow();
    await expect(database.exec(`
      insert into user_saved_article_sources (user_id, source_url, normalized_url)
      values ('${userB}', 'https://example.com/b', 'https://example.com/b');
    `)).rejects.toThrow();
  });
});
