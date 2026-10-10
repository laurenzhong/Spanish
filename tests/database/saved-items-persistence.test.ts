// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createDrizzleReadingRepository } from "@/src/modules/reading";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-0000000000a1";
const userB = "00000000-0000-4000-8000-0000000000b1";
const articleId = "10000000-0000-4000-8000-0000000000a1";
const sourceId = "20000000-0000-4000-8000-0000000000a1";
const versionId = "30000000-0000-4000-8000-0000000000a1";

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
    "0013_smart_stick.sql",
    "0014_parallel_liz_osborn.sql",
    "0023_article_acquisition.sql",
  ]) await client.exec(await migration(name));
  const database = drizzle(client, { schema });
  await client.exec(`insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test');`);
  await database.insert(schema.articleSources).values({
    id: sourceId,
    license: "original",
    sourceName: "Sueño Editorial",
    sourceType: "original",
    sourceUrl: "https://example.test/story",
    copyrightStatus: "cleared",
  });
  await database.insert(schema.articles).values({ id: articleId, stableKey: "article.saved-items-test" });
  await database.insert(schema.articleVersions).values({
    articleId,
    assets: [],
    cefrLevel: "A2",
    contentHash: "a".repeat(64),
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
    title: "Una historia guardada",
    topics: ["topic.daily-life"],
    version: 1,
  });
  await database.insert(schema.articleSegments).values([
    { articleVersionId: versionId, position: 0, sourceText: "Llegó de repente a casa." },
    { articleVersionId: versionId, position: 1, sourceText: "Después tomó un café." },
  ]);
  return { client, database, repository: createDrizzleReadingRepository(database) };
}

describe("saved reading items persistence", () => {
  let client: PGlite;

  afterEach(async () => {
    await client.close();
  });

  it("projects saved phrases/highlights with article context and isolates users", async () => {
    ({ client } = await setup());
    const database = drizzle(client, { schema });
    const repository = createDrizzleReadingRepository(database);
    await repository.upsertState(userA, "article.saved-items-test@1", {
      contentHash: "a".repeat(64),
      highlights: [{ position: 1, text: "tomó un café" }],
      note: "",
      position: 0,
      saved: false,
      savedPhrases: [{ position: 0, text: "de repente" }],
      status: "in_progress",
    });

    const result = await repository.listSavedItems(userA, { page: 1, pageSize: 24 });
    expect(result.total).toBe(2);
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemType: "phrase", text: "de repente", context: "Llegó de repente a casa.", title: "Una historia guardada" }),
      expect.objectContaining({ itemType: "highlight", text: "tomó un café", context: "Después tomó un café." }),
    ]));
    await expect(repository.listSavedItems(userB, { page: 1, pageSize: 24 })).resolves.toMatchObject({ total: 0, items: [] });
  });

  it("filters by type/search and paginates before returning rows", async () => {
    ({ client } = await setup());
    const database = drizzle(client, { schema });
    const repository = createDrizzleReadingRepository(database);
    await repository.upsertState(userA, "article.saved-items-test@1", {
      contentHash: "a".repeat(64),
      highlights: [{ position: 1, text: "tomó un café" }],
      note: "",
      position: 0,
      saved: false,
      savedPhrases: [{ position: 0, text: "de repente" }],
      status: "in_progress",
    });
    await expect(repository.listSavedItems(userA, { itemType: "phrase", search: "REPENTE", page: 1, pageSize: 1 })).resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ text: "de repente" })] });
    await expect(repository.listSavedItems(userA, { page: 2, pageSize: 1 })).resolves.toMatchObject({ page: 2, pageSize: 1, total: 2, items: [expect.anything()] });
  });

  it("deletes an item only for its owner", async () => {
    ({ client } = await setup());
    const database = drizzle(client, { schema });
    const repository = createDrizzleReadingRepository(database);
    await repository.upsertState(userA, "article.saved-items-test@1", {
      contentHash: "a".repeat(64),
      highlights: [],
      note: "",
      position: 0,
      saved: false,
      savedPhrases: [{ position: 0, text: "de repente" }],
      status: "in_progress",
    });
    const saved = await repository.listSavedItems(userA, { page: 1, pageSize: 24 });
    const itemId = saved.items[0]?.id;
    expect(itemId).toBeTruthy();
    if (!itemId) return;
    await expect(repository.deleteSavedItem(userB, itemId)).resolves.toBe(false);
    await expect(repository.listSavedItems(userA, { page: 1, pageSize: 24 })).resolves.toMatchObject({ total: 1 });
    await expect(repository.deleteSavedItem(userA, itemId)).resolves.toBe(true);
    await expect(repository.deleteSavedItem(userA, itemId)).resolves.toBe(false);
    await expect(repository.listSavedItems(userA, { page: 1, pageSize: 24 })).resolves.toMatchObject({ total: 0, items: [] });
  });

  it("keeps saved-item identity and save time stable across reading progress syncs", async () => {
    ({ client } = await setup());
    const database = drizzle(client, { schema });
    const repository = createDrizzleReadingRepository(database);
    const patch = {
      contentHash: "a".repeat(64),
      highlights: [{ position: 1, text: "tomó un café" }],
      note: "",
      position: 0,
      saved: false,
      savedPhrases: [{ position: 0, text: "de repente" }],
      status: "in_progress" as const,
    };
    await repository.upsertState(userA, "article.saved-items-test@1", patch);
    const first = await repository.listSavedItems(userA, { page: 1, pageSize: 24 });
    await repository.upsertState(userA, "article.saved-items-test@1", { ...patch, position: 1 });
    const second = await repository.listSavedItems(userA, { page: 1, pageSize: 24 });
    expect(second.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
    expect(second.items.map((item) => item.createdAt)).toEqual(first.items.map((item) => item.createdAt));
  });
});

const privateSourceId = "20000000-0000-4000-8000-0000000000b2";
const storyArticleId = "10000000-0000-4000-8000-0000000000b2";
const storyVersionId = "30000000-0000-4000-8000-0000000000b2";
const draftArticleId = "10000000-0000-4000-8000-0000000000c2";
const draftVersionId = "30000000-0000-4000-8000-0000000000c2";
const otherStoryArticleId = "10000000-0000-4000-8000-0000000000d2";
const otherStoryVersionId = "30000000-0000-4000-8000-0000000000d2";

const savedAt = new Date("2026-01-02T00:00:00.000Z");
const storyCreatedAt = new Date("2026-01-04T00:00:00.000Z");
const otherSavedAt = new Date("2026-01-05T00:00:00.000Z");

/**
 * Seeds the article-kind shelf: one public article saved by both users, one
 * private AI story owned by A, one private story owned by B, and one saved
 * draft version that must never surface.
 */
async function seedArticleShelf(client: PGlite) {
  const database = drizzle(client, { schema });
  await database.insert(schema.articleSources).values({
    id: privateSourceId,
    copyrightStatus: "cleared",
    license: "original",
    sourceName: "Sueño Story Bot",
    sourceType: "ai-generated",
  });
  await database.insert(schema.articles).values([
    { id: storyArticleId, stableKey: "article.private-story" },
    { id: draftArticleId, stableKey: "article.unpublished-draft" },
    { id: otherStoryArticleId, stableKey: "article.other-story" },
  ]);
  const versionValues = {
    assets: [],
    cefrLevel: "A2",
    contentHash: "b".repeat(64),
    estimatedReadingMinutes: 4,
    format: "story",
    locale: "es-ES",
    oralTransferType: "summary",
    relatedExpressionKeys: [],
    relatedGoalKeys: [],
    relatedTagKeys: [],
    region: "es-ES",
    register: "neutral",
    sourceId: privateSourceId,
    summary: "Un cuento privado de prueba.",
    topics: ["topic.daily-life"],
    version: 1,
  };
  await database.insert(schema.articleVersions).values([
    { ...versionValues, articleId: storyArticleId, id: storyVersionId, status: "published", title: "Un cuento privado" },
    { ...versionValues, articleId: draftArticleId, id: draftVersionId, status: "draft", title: "Un borrador guardado" },
    { ...versionValues, articleId: otherStoryArticleId, id: otherStoryVersionId, status: "published", title: "El cuento de otra persona" },
  ]);
  await database.insert(schema.userGeneratedArticles).values([
    {
      articleVersionId: storyVersionId,
      cefr: "A2",
      contentHash: "c".repeat(64),
      createdAt: storyCreatedAt,
      format: "story",
      idempotencyKey: "story-key-a",
      keywords: [],
      length: "short",
      modelVersion: "test-model",
      prompt: "Un cuento privado",
      provider: "test-provider",
      requestId: "request-a",
      userId: userA,
    },
    {
      articleVersionId: otherStoryVersionId,
      cefr: "A2",
      contentHash: "d".repeat(64),
      format: "story",
      idempotencyKey: "story-key-b",
      keywords: [],
      length: "short",
      modelVersion: "test-model",
      prompt: "El cuento de otra persona",
      provider: "test-provider",
      requestId: "request-b",
      userId: userB,
    },
  ]);
  // A's saves: the public article, a stale save of another user's story, and a
  // save of a draft version that today's reader can no longer reach.
  await database.insert(schema.userArticleSaves).values([
    { articleVersionId: versionId, createdAt: savedAt, userId: userA },
    { articleVersionId: otherStoryVersionId, createdAt: otherSavedAt, userId: userA },
    { articleVersionId: draftVersionId, createdAt: otherSavedAt, userId: userA },
    { articleVersionId: versionId, createdAt: otherSavedAt, userId: userB },
  ]);
  return { database, repository: createDrizzleReadingRepository(database) };
}

describe("saved article shelf persistence", () => {
  let client: PGlite;

  afterEach(async () => {
    await client.close();
  });

  it("lists saved articles and the owner's private stories newest-first", async () => {
    ({ client } = await setup());
    const { repository } = await seedArticleShelf(client);

    const result = await repository.listSavedArticleShelf(userA, { page: 1, pageSize: 24 });
    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      expect.objectContaining({
        articleId: "article.private-story@1",
        itemType: "article",
        origin: "generated",
        saved: false,
        createdAt: storyCreatedAt,
        title: "Un cuento privado",
      }),
      expect.objectContaining({
        articleId: "article.saved-items-test@1",
        itemType: "article",
        origin: "public",
        saved: true,
        createdAt: savedAt,
        title: "Una historia guardada",
      }),
    ]);
  });

  it("never exposes another user's private story, saved or not", async () => {
    ({ client } = await setup());
    const { repository } = await seedArticleShelf(client);

    const userBShelf = await repository.listSavedArticleShelf(userB, { page: 1, pageSize: 24 });
    // B sees B's own private story and B's own save, never A's story.
    expect(userBShelf.items.map((item) => item.articleId).sort()).toEqual(["article.other-story@1", "article.saved-items-test@1"]);
    expect(userBShelf.items.map((item) => item.articleId)).not.toContain("article.private-story@1");
    // The stale save row pointing at B's story must not leak B's title to A.
    const userAShelf = await repository.listSavedArticleShelf(userA, { page: 1, pageSize: 24 });
    expect(userAShelf.items.map((item) => item.title)).not.toContain("El cuento de otra persona");
  });

  it("hides saved versions that are not published", async () => {
    ({ client } = await setup());
    const { repository } = await seedArticleShelf(client);
    const result = await repository.listSavedArticleShelf(userA, { page: 1, pageSize: 24 });
    expect(result.items.map((item) => item.articleId)).not.toContain("article.unpublished-draft@1");
  });

  it("searches titles, summaries and sources and paginates exactly", async () => {
    ({ client } = await setup());
    const { repository } = await seedArticleShelf(client);

    await expect(repository.listSavedArticleShelf(userA, { search: "privado", page: 1, pageSize: 24 }))
      .resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ articleId: "article.private-story@1" })] });
    await expect(repository.listSavedArticleShelf(userA, { search: "Sueño Editorial", page: 1, pageSize: 24 }))
      .resolves.toMatchObject({ total: 1, items: [expect.objectContaining({ articleId: "article.saved-items-test@1" })] });

    await expect(repository.listSavedArticleShelf(userA, { page: 1, pageSize: 1 }))
      .resolves.toMatchObject({ total: 2, page: 1, pageSize: 1, items: [expect.objectContaining({ articleId: "article.private-story@1" })] });
    await expect(repository.listSavedArticleShelf(userA, { page: 2, pageSize: 1 }))
      .resolves.toMatchObject({ total: 2, page: 2, pageSize: 1, items: [expect.objectContaining({ articleId: "article.saved-items-test@1" })] });
    await expect(repository.listSavedArticleShelf(userA, { page: 3, pageSize: 1 }))
      .resolves.toMatchObject({ total: 2, items: [] });
  });

  it("drops the article from the shelf when it is unsaved", async () => {
    ({ client } = await setup());
    const { repository } = await seedArticleShelf(client);

    await expect(repository.setSaved(userA, "article.saved-items-test@1", true)).resolves.toBe(true);
    const before = await repository.listSavedArticleShelf(userA, { page: 1, pageSize: 24 });
    expect(before.items.map((item) => item.articleId)).toContain("article.saved-items-test@1");
    expect(before.items.find((item) => item.articleId === "article.saved-items-test@1")).toMatchObject({ saved: true });

    await expect(repository.setSaved(userA, "article.saved-items-test@1", false)).resolves.toBe(false);
    const after = await repository.listSavedArticleShelf(userA, { page: 1, pageSize: 24 });
    expect(after.items.map((item) => item.articleId)).not.toContain("article.saved-items-test@1");
    expect(after.total).toBe(1);
    // The reader star reads the same fact through the ids projection. That
    // projection stays id-only and unfiltered on purpose (it also lists stale
    // rows), so only assert what the shelf cares about here.
    await expect(repository.listSavedArticleIds(userA)).resolves.not.toContain("article.saved-items-test@1");

    // Unsaving twice stays idempotent and writes no reading state.
    await expect(repository.setSaved(userA, "article.saved-items-test@1", false)).resolves.toBe(false);
    await expect(repository.listSavedArticleShelf(userA, { page: 1, pageSize: 24 })).resolves.toMatchObject({ total: 1 });
  });

  it("keeps a private story listed after it is unsaved", async () => {
    ({ client } = await setup());
    const { repository } = await seedArticleShelf(client);

    await repository.setSaved(userA, "article.private-story@1", true);
    const savedStory = await repository.listSavedArticleShelf(userA, { page: 1, pageSize: 24 });
    expect(savedStory.items[0]).toMatchObject({ articleId: "article.private-story@1", saved: true, origin: "generated" });

    await repository.setSaved(userA, "article.private-story@1", false);
    const unsavedStory = await repository.listSavedArticleShelf(userA, { page: 1, pageSize: 24 });
    expect(unsavedStory.items[0]).toMatchObject({ articleId: "article.private-story@1", saved: false, origin: "generated" });
    expect(unsavedStory.total).toBe(2);
  });
});
