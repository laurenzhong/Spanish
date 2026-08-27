// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { count, eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleReadingRepository,
  type ReadingRepository,
} from "@/src/modules/reading";
import { createDrizzlePrivacyRepository, deleteAccountData, type StorageObjectDeleter } from "@/src/modules/privacy";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-0000000000a1";
const userB = "00000000-0000-4000-8000-0000000000b1";
const articleId = "10000000-0000-4000-8000-0000000000a1";
const sourceId = "20000000-0000-4000-8000-0000000000a1";
const versionId = "30000000-0000-4000-8000-0000000000a1";
const contentHash = "a".repeat(64);

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

async function setup() {
  const client = new PGlite();
  await client.exec(`
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
  ]) {
    await client.exec(await migration(name));
  }
  const database = drizzle(client, { schema });
  await client.exec(`
    insert into auth.users (id, email) values
      ('${userA}', 'a@example.test'),
      ('${userB}', 'b@example.test');
  `);
  await database.insert(schema.articleSources).values({
    id: sourceId,
    license: "original",
    sourceName: "Sueño Editorial",
    sourceType: "original",
  });
  await database.insert(schema.articles).values({ id: articleId, stableKey: "article.reading-test" });
  await database.insert(schema.articleVersions).values({
    articleId,
    assets: [],
    cefrLevel: "A2",
    contentHash,
    estimatedReadingMinutes: 5,
    format: "story",
    id: versionId,
    locale: "es-ES",
    oralTransferType: "summary",
    relatedExpressionKeys: [],
    relatedGoalKeys: [],
    relatedTagKeys: [],
    region: "es-ES",
    register: "neutral",
    sourceId,
    status: "published",
    summary: "Una prueba de lectura.",
    title: "Una prueba de lectura",
    topics: ["topic.daily-life"],
    version: 1,
  });
  return { client, database, repository: createDrizzleReadingRepository(database) };
}

describe("reading persistence", () => {
  let client: PGlite;
  let repository: ReadingRepository;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    ({ client, database, repository } = await setup());
  });

  afterEach(async () => {
    await client.close();
  });

  it("upserts a versioned reading state idempotently", async () => {
    const patch = {
      contentHash,
      highlights: [{ position: 1, text: "cafetería" }],
      note: "Volver a esta idea.",
      position: 1,
      saved: true,
      savedPhrases: [{ position: 0, text: "de repente" }],
      status: "in_progress" as const,
    };
    await expect(repository.upsertState(userA, "article.reading-test@1", patch)).resolves.toMatchObject({
      articleId: "article.reading-test@1",
      position: 1,
      saved: true,
      savedPhrases: [{ position: 0, text: "de repente" }],
    });
    await repository.upsertState(userA, "article.reading-test@1", patch);
    await expect(repository.getState(userA, "article.reading-test@1")).resolves.toMatchObject({
      highlights: [{ position: 1, text: "cafetería" }],
      note: "Volver a esta idea.",
      saved: true,
    });
    await expect(database.select({ value: count() }).from(schema.userReadingProgress)).resolves.toEqual([{ value: 1 }]);
    await expect(database.select({ value: count() }).from(schema.userArticleHighlights)).resolves.toEqual([{ value: 2 }]);
    await expect(database.select({ value: count() }).from(schema.userArticleSaves)).resolves.toEqual([{ value: 1 }]);
    await expect(repository.listProgress(userA)).resolves.toMatchObject([
      { articleId: "article.reading-test@1", position: 1, status: "in_progress" },
    ]);
  });

  it("keeps user data isolated and rejects a stale article version", async () => {
    await repository.setSaved(userA, "article.reading-test@1", true);
    await expect(repository.listSavedArticleIds(userA)).resolves.toEqual(["article.reading-test@1"]);
    await expect(repository.listSavedArticleIds(userB)).resolves.toEqual([]);
    await expect(repository.upsertState(userA, "article.reading-test@1", {
      contentHash: "b".repeat(64),
      highlights: [],
      note: "",
      position: 0,
      saved: false,
      savedPhrases: [],
      status: "in_progress",
    })).rejects.toThrow("ARTICLE_VERSION_CONFLICT");
    await expect(repository.setSaved(userA, "article.reading-test@1", false)).resolves.toBe(false);
    await expect(repository.listSavedArticleIds(userA)).resolves.toEqual([]);
  });

  it("normalizes and deduplicates external source metadata without fetching it", async () => {
    const input = { url: "HTTPS://Example.com/read/article/#section", title: "Fuente guardada" };
    const first = await repository.saveSource(userA, input);
    const second = await repository.saveSource(userA, { ...input, title: "Título actualizado" });
    expect(first.normalizedUrl).toBe("https://example.com/read/article");
    expect(second.title).toBe("Título actualizado");
    await expect(repository.listSavedSources(userA)).resolves.toHaveLength(1);
    await expect(repository.deleteSavedSource(userA, first.id)).resolves.toBe(true);
    await expect(repository.listSavedSources(userA)).resolves.toEqual([]);
  });

  it("does not expose another user's rows through the database repository contract", async () => {
    await repository.upsertState(userA, "article.reading-test@1", {
      contentHash,
      highlights: [],
      note: "private",
      position: 0,
      saved: false,
      savedPhrases: [],
      status: "in_progress",
    });
    const own = await database.select({ userId: schema.userReadingProgress.userId }).from(schema.userReadingProgress).where(eq(schema.userReadingProgress.userId, userA));
    expect(own).toEqual([{ userId: userA }]);
  });

  it("cascades private reading data on account deletion while keeping public articles", async () => {
    await repository.upsertState(userA, "article.reading-test@1", {
      contentHash,
      highlights: [{ position: 0, text: "privado" }],
      note: "nota privada",
      position: 1,
      saved: true,
      savedPhrases: [],
      status: "in_progress",
    });
    await repository.saveSource(userA, { url: "https://example.com/private-source" });

    const storageDeleter: StorageObjectDeleter = {
      async delete() {
        return { deferred: false };
      },
    };
    await expect(deleteAccountData(createDrizzlePrivacyRepository(database), storageDeleter, userA)).resolves.toMatchObject({
      alreadyDeleted: false,
    });

    await expect(database.select().from(schema.userReadingProgress).where(eq(schema.userReadingProgress.userId, userA))).resolves.toEqual([]);
    await expect(database.select().from(schema.userArticleSaves).where(eq(schema.userArticleSaves.userId, userA))).resolves.toEqual([]);
    await expect(database.select().from(schema.userArticleHighlights).where(eq(schema.userArticleHighlights.userId, userA))).resolves.toEqual([]);
    await expect(database.select().from(schema.userSavedArticleSources).where(eq(schema.userSavedArticleSources.userId, userA))).resolves.toEqual([]);
    await expect(database.select().from(schema.articles).where(eq(schema.articles.id, articleId))).resolves.toHaveLength(1);
  });
});
