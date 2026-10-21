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
      create table media_versions (id uuid primary key, media_item_id uuid not null, version integer not null, status text not null, copyright_status text not null, title text not null, source_name text, published_at timestamptz);
      create table media_segments (media_version_id uuid not null, segment_index integer not null, source_text text not null, start_ms integer not null, end_ms integer not null, review_status text not null);
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

  it("reports a failed segment read instead of claiming the content library is empty", async () => {
    await client.exec("drop table article_segments");
    const repository = createDrizzleLexiconCorpusRepository(database as unknown as Database);
    await expect(repository.listCorpusClusters(undefined, {
      documentKind: "article",
      contentKind: "article",
      page: 1,
      pageSize: 8,
    })).rejects.toThrow();
    await expect(repository.listPhrases(undefined, {
      page: 1,
      pageSize: 24,
    })).rejects.toThrow();
  });

  it("spreads default phrase browsing across published source types and documents", async () => {
    await client.exec(`
      insert into articles (id, stable_key) values
        ('10000000-0000-4000-8000-000000000011', 'article.a'),
        ('10000000-0000-4000-8000-000000000012', 'article.b');
      insert into article_sources (id, copyright_status) values
        ('20000000-0000-4000-8000-000000000011', 'cleared'),
        ('20000000-0000-4000-8000-000000000012', 'cleared');
      insert into article_versions (id, article_id, source_id, version, status, title, published_at) values
        ('30000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000011', 1, 'published', 'Article A', now()),
        ('30000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000012', 1, 'published', 'Article B', now());
      insert into article_segments (article_version_id, position, source_text) values
        ('30000000-0000-4000-8000-000000000011', 0, 'Nueva receta deliciosa llega.'),
        ('30000000-0000-4000-8000-000000000012', 0, 'Cuentan historias interesantes hoy.');
      insert into media_items (id, stable_key, kind) values
        ('40000000-0000-4000-8000-000000000011', 'video.a', 'video'),
        ('40000000-0000-4000-8000-000000000012', 'video.b', 'video'),
        ('40000000-0000-4000-8000-000000000013', 'podcast.a', 'podcast'),
        ('40000000-0000-4000-8000-000000000014', 'podcast.b', 'podcast');
      insert into media_versions (id, media_item_id, version, status, copyright_status, title, published_at) values
        ('50000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000011', 1, 'published', 'cleared', 'Video A', now()),
        ('50000000-0000-4000-8000-000000000012', '40000000-0000-4000-8000-000000000012', 1, 'published', 'cleared', 'Video B', now()),
        ('50000000-0000-4000-8000-000000000013', '40000000-0000-4000-8000-000000000013', 1, 'published', 'cleared', 'Podcast A', now()),
        ('50000000-0000-4000-8000-000000000014', '40000000-0000-4000-8000-000000000014', 1, 'published', 'cleared', 'Podcast B', now());
      insert into media_segments (media_version_id, segment_index, source_text, start_ms, end_ms, review_status) values
        ('50000000-0000-4000-8000-000000000011', 0, 'Tomamos chocolate caliente juntos.', 1000, 2000, 'approved'),
        ('50000000-0000-4000-8000-000000000012', 0, 'Paseamos calles antiguas juntos.', 1000, 2000, 'approved'),
        ('50000000-0000-4000-8000-000000000013', 0, 'Hablamos lugares remotos tranquilos.', 1000, 2000, 'approved'),
        ('50000000-0000-4000-8000-000000000014', 0, 'Descubrimos comidas regionales diversas.', 1000, 2000, 'approved');
    `);
    const repository = createDrizzleLexiconCorpusRepository(database as unknown as Database);
    const first = await repository.listPhrases(undefined, { page: 1, pageSize: 3 });
    const second = await repository.listPhrases(undefined, { page: 2, pageSize: 3 });
    const sourceKeys = [...first.items, ...second.items].map((item) => item.representativeOccurrence?.document.stableKey);
    expect(first.total).toBe(6);
    expect(sourceKeys).toEqual(["article.a", "video.a", "podcast.a", "article.b", "video.b", "podcast.b"]);
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(6);
  });
});
