// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import {
  ContentImportConflictError,
  importContentBundle,
  validateContentBundle,
} from "@/src/modules/content/import";
import { hashArticleContent } from "@/src/modules/content/import/content-hash";
import * as schema from "@/src/shared/db/schema";

const migrationNames = [
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
];

async function setup() {
  const client = new PGlite();
  await client.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  for (const name of migrationNames) {
    await client.exec(
      (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    );
  }
  return { client, database: drizzle(client, { schema }) };
}

type TestArticle = {
  contentHash: string;
  status: string;
  segments: Array<{ position: number; text: string }>;
  relatedGoalKeys: string[];
  [key: string]: unknown;
};

type TestBundle = {
  articles: TestArticle[];
  [key: string]: unknown;
};

async function fixture(): Promise<TestBundle> {
  return JSON.parse(
    await readFile(path.join(process.cwd(), "content", "bundles", "alpha-core-v1.json"), "utf8"),
  ) as TestBundle;
}

describe("article content contract", () => {
  it("imports article source, version, segments and assets idempotently", { timeout: 30_000 }, async () => {
    const { client, database } = await setup();
    try {
      const input = await fixture();
      await expect(importContentBundle(database, input)).resolves.toMatchObject({
        status: "imported",
        counts: { articles: 1 },
      });
      await expect(importContentBundle(database, input)).resolves.toMatchObject({
        status: "unchanged",
      });
      await expect(database.select({ value: count() }).from(schema.articles)).resolves.toEqual([{ value: 1 }]);
      await expect(database.select({ value: count() }).from(schema.articleVersions)).resolves.toEqual([{ value: 1 }]);
      await expect(database.select({ value: count() }).from(schema.articleSegments)).resolves.toEqual([{ value: 3 }]);
      await expect(database.select({ value: count() }).from(schema.articleAssets)).resolves.toEqual([{ value: 4 }]);
    } finally {
      await client.close();
    }
  });

  it("rejects invalid positions, references, hashes and published copyright", { timeout: 30_000 }, async () => {
    const input = await fixture();
    const article = input.articles[0];

    const duplicate = structuredClone(input);
    duplicate.articles[0].segments[1].position = 0;
    expect(() => validateContentBundle(duplicate)).toThrow();

    const unknownReference = structuredClone(input);
    unknownReference.articles[0].relatedGoalKeys = ["missing.goal"];
    unknownReference.articles[0].contentHash = hashArticleContent(unknownReference.articles[0]);
    expect(() => validateContentBundle(unknownReference)).toThrow(/Unknown related goal/);

    const published = structuredClone(input);
    published.articles[0].status = "published";
    expect(() => validateContentBundle(published)).toThrow(/Published articles require publishedAt/);

    const html = structuredClone(input);
    html.articles[0].segments[0].text = "<p>Texto sin limpiar</p>";
    html.articles[0].contentHash = hashArticleContent(html.articles[0]);
    expect(() => validateContentBundle(html)).toThrow(/cleaned plain text/);
    expect(article.contentHash).toHaveLength(64);
  });

  it("rejects a different hash for the same article version", { timeout: 30_000 }, async () => {
    const { client, database } = await setup();
    try {
      const input = await fixture();
      await importContentBundle(database, input);
      const changed = structuredClone(input);
      changed.articles[0].segments[0].text += " Y sonríe.";
      changed.articles[0].contentHash = hashArticleContent(changed.articles[0]);
      await expect(importContentBundle(database, changed)).rejects.toBeInstanceOf(ContentImportConflictError);
    } finally {
      await client.close();
    }
  });

  it("rolls back the whole bundle when article write fails", { timeout: 30_000 }, async () => {
    const { client, database } = await setup();
    try {
      await client.exec(`
        create function fail_article_import() returns trigger language plpgsql as $$ begin raise exception 'forced article failure'; end; $$;
        create trigger fail_article_import_trigger before insert on article_versions for each row execute function fail_article_import();
      `);
      await expect(importContentBundle(database, await fixture())).rejects.toThrow();
      await expect(database.select({ value: count() }).from(schema.contentBundleImports)).resolves.toEqual([{ value: 0 }]);
      await expect(database.select({ value: count() }).from(schema.articles)).resolves.toEqual([{ value: 0 }]);
      await expect(database.select({ value: count() }).from(schema.communicationDomains)).resolves.toEqual([{ value: 0 }]);
    } finally {
      await client.close();
    }
  });
});
