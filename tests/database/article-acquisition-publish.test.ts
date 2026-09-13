// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeArticleCandidate } from "@/src/modules/content-acquisition";
import {
  AcquiredArticlePersistenceConflictError,
  createDrizzleArticleRepository,
} from "@/src/modules/content/repositories";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const candidateId = "00000000-0000-4000-8000-000000000801";

async function setupDatabase() {
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
    "0023_article_acquisition.sql",
  ]) {
    const sql = (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
      .replaceAll("--> statement-breakpoint", "");
    await client.exec(sql);
  }
  return { client, database: drizzle(client, { schema }) };
}

function draft() {
  return normalizeArticleCandidate({
    sourceStableKey: "news.example",
    externalItemId: "article-1",
    canonicalUrl: "https://news.example.test/article-1",
    title: "Una noticia",
    summary: "Resumen breve.",
    author: "María Ejemplo",
    publishedAt: "2026-09-12T06:30:00.000Z",
    fetchedAt: "2026-09-13T00:00:00.000Z",
    paragraphs: ["Primer párrafo.", "Segundo párrafo."],
    source: {
      sourceName: "Noticias de ejemplo",
      sourceType: "creative_commons",
      license: "creative_commons",
      attribution: "Noticias de ejemplo / CC BY 4.0",
      licenseEvidence: "https://news.example.test/licencia",
    },
    defaults: {
      cefr: "B1",
      topics: ["topic.current-events"],
      region: "es-ES",
      register: "neutral",
      format: "news",
      oralTransferType: "opinion",
    },
  }).metadata.articleDraft;
}

const reviews = [
  { locale: "es-ES" as const, reviewerReference: "codex-ai-owner-authorized-review" as const, notes: "Revisión española.", reviewedAt: new Date("2026-09-13T01:00:00.000Z") },
  { locale: "zh-CN" as const, reviewerReference: "codex-ai-owner-authorized-review" as const, notes: "中文教学复核。", reviewedAt: new Date("2026-09-13T01:00:00.000Z") },
] as const;

describe("acquired article publication persistence", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    ({ client, database } = await setupDatabase());
  }, 20_000);

  afterEach(async () => {
    await client.close();
  });

  function repository() {
    return createDrizzleArticleRepository(database as unknown as Database);
  }

  it("publishes an immutable version idempotently with provenance and two review records", async () => {
    const article = draft();
    const input = {
      candidateId,
      candidateRevision: 5,
      contentHash: article.contentHash,
      draft: article,
      reviews,
      publishedAt: new Date("2026-09-13T02:00:00.000Z"),
    };
    const first = await repository().publishAcquired(input);
    await expect(repository().publishAcquired(input)).resolves.toEqual(first);
    expect(first).toEqual({ kind: "article", stableKey: article.stableKey, version: 1 });

    await expect(repository().findById?.(`${article.stableKey}@1`)).resolves.toMatchObject({
      reason: "found",
      article: {
        title: article.title,
        sourceUrl: article.canonicalUrl,
        segments: [{ position: 0, text: "Primer párrafo." }, { position: 1, text: "Segundo párrafo." }],
      },
    });
    const [source] = await database.select().from(schema.articleSources).where(eq(schema.articleSources.acquisitionCandidateId, candidateId));
    expect(source).toMatchObject({
      acquisitionCandidateRevision: 5,
      fetchedAt: new Date("2026-09-13T00:00:00.000Z"),
      sourceUrl: article.canonicalUrl,
      licenseEvidence: article.licenseEvidence,
    });
    const [reviewCount] = await database.select({ value: count() }).from(schema.contentReviews);
    expect(reviewCount?.value).toBe(2);

    await expect(repository().publishAcquired({ ...input, contentHash: "f".repeat(64) })).rejects.toBeInstanceOf(AcquiredArticlePersistenceConflictError);
    const [versionCount] = await database.select({ value: count() }).from(schema.articleVersions);
    expect(versionCount?.value).toBe(1);
  });

  it("archives only the matching candidate projection and removes it from public queries", async () => {
    const article = draft();
    const publication = await repository().publishAcquired({
      candidateId,
      candidateRevision: 5,
      contentHash: article.contentHash,
      draft: article,
      reviews,
      publishedAt: new Date("2026-09-13T02:00:00.000Z"),
    });
    await repository().archiveAcquired({
      candidateId,
      publication,
      archivedAt: new Date("2026-09-13T03:00:00.000Z"),
    });

    await expect(repository().findById?.(`${article.stableKey}@1`)).resolves.toEqual({ article: null, reason: "unpublished" });
    await expect(repository().list()).resolves.toMatchObject({ articles: [], totalCount: 0 });
    await expect(repository().archiveAcquired({
      candidateId: "00000000-0000-4000-8000-000000000899",
      publication,
      archivedAt: new Date("2026-09-13T04:00:00.000Z"),
    })).rejects.toBeInstanceOf(AcquiredArticlePersistenceConflictError);
  });
});
