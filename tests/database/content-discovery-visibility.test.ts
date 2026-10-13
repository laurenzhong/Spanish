// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrizzleLexiconCorpusRepository } from "@/src/modules/lexicon-corpus";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

async function migration(name: string): Promise<string> {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

describe("content discovery visibility", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(
      "create role anon nologin; create role authenticated nologin; create schema auth; "
      + "create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); "
      + "create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; "
      + "grant usage on schema auth, public to anon, authenticated; "
      + "grant execute on function auth.uid() to anon, authenticated;",
    );
    await client.exec(await migration("0000_big_phalanx.sql"));
    await client.exec(await migration("0021_shallow_killmonger.sql"));
    await client.exec(await migration("0037_migration_reconcile.sql"));
    await client.exec(`
      create table articles (id uuid primary key, stable_key text not null unique);
      create table article_sources (id uuid primary key, copyright_status text not null);
      create table article_versions (
        id uuid primary key,
        article_id uuid not null,
        source_id uuid not null,
        version integer not null,
        status text not null,
        title text not null,
        published_at timestamptz
      );
      create table article_segments (article_version_id uuid not null, position integer not null, source_text text not null);
      create table user_generated_articles (id uuid primary key, article_version_id uuid unique);
      create table media_items (id uuid primary key, stable_key text not null unique, kind text not null);
      create table media_versions (media_item_id uuid not null, version integer not null, status text not null, copyright_status text not null);
    `);
    database = drizzle(client, { schema });
  });

  afterEach(async () => {
    await client.close();
  });

  it("only discovers public, cleared article content", async () => {
    await client.exec(`
      insert into articles (id, stable_key) values
        ('10000000-0000-4000-8000-000000000001', 'article.public'),
        ('10000000-0000-4000-8000-000000000002', 'article.restricted'),
        ('10000000-0000-4000-8000-000000000003', 'article.private');
      insert into article_sources (id, copyright_status) values
        ('20000000-0000-4000-8000-000000000001', 'cleared'),
        ('20000000-0000-4000-8000-000000000002', 'restricted'),
        ('20000000-0000-4000-8000-000000000003', 'cleared');
      insert into article_versions (id, article_id, source_id, version, status, title, published_at) values
        ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, 'published', 'Visible', now()),
        ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 1, 'published', 'Restricted', now()),
        ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 1, 'published', 'Private', now());
      insert into article_segments (article_version_id, position, source_text) values
        ('30000000-0000-4000-8000-000000000001', 0, 'Una historia clara.'),
        ('30000000-0000-4000-8000-000000000002', 0, 'Una historia restringida.'),
        ('30000000-0000-4000-8000-000000000003', 0, 'Una historia privada.');
      insert into user_generated_articles (id, article_version_id) values
        ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003');
    `);

    const repository = createDrizzleLexiconCorpusRepository(database as unknown as Database);
    const page = await repository.listCorpusClusters(undefined, {
      documentKind: "article",
      contentKind: "article",
      page: 1,
      pageSize: 8,
    });
    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.expression).sort()).toEqual([
      "Una historia",
      "Una historia clara",
      "historia clara",
    ]);
    expect(page.items.every((item) => item.contentKinds.includes("article"))).toBe(true);
  });
});
