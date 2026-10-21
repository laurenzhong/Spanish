// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrizzleLexiconCorpusRepository, LexicalIntentConflictError } from "@/src/modules/lexicon-corpus";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-0000000000a1";
const userB = "00000000-0000-4000-8000-0000000000b1";
const articleId = "30000000-0000-4000-8000-000000000002";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

const reference = {
  document: { kind: "article" as const, stableKey: "article.lexicon", version: 1 },
  position: { kind: "text" as const, paragraphId: "p1", segmentIndex: 0 },
  sourceText: "Comiendo juntos.", contextBefore: "", contextAfter: "",
};

describe("lexicon persistence", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleLexiconCorpusRepository>;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
    await client.exec(await migration("0000_big_phalanx.sql"));
    await client.exec(await migration("0021_shallow_killmonger.sql"));
    await client.exec(await migration("0037_migration_reconcile.sql"));
    await client.exec(`
      create table articles (id uuid primary key, stable_key text not null unique);
      create table article_sources (id uuid primary key, copyright_status text not null);
      create table article_versions (id uuid primary key, article_id uuid not null, source_id uuid not null, version integer not null, status text not null, title text not null default 'Fixture', published_at timestamptz);
      create table article_segments (article_version_id uuid not null, position integer not null, source_text text not null);
      create table user_generated_articles (id uuid primary key, article_version_id uuid not null unique, user_id uuid not null);
      create table media_items (id uuid primary key, stable_key text not null unique, kind text not null);
      create table media_versions (id uuid primary key default gen_random_uuid(), media_item_id uuid not null, version integer not null, status text not null, copyright_status text not null, title text not null default 'Fixture', source_name text, published_at timestamptz);
      create table media_segments (media_version_id uuid not null, segment_index integer not null, source_text text not null, start_ms integer not null, end_ms integer not null, review_status text not null);
      insert into articles (id, stable_key) values ('${articleId}', 'article.lexicon');
      insert into article_sources (id, copyright_status) values ('40000000-0000-4000-8000-000000000001', 'cleared');
      insert into article_versions (id, article_id, source_id, version, status) values ('50000000-0000-4000-8000-000000000001', '${articleId}', '40000000-0000-4000-8000-000000000001', 1, 'published');
    `);
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id, email) values ('${userA}', 'a@example.test'), ('${userB}', 'b@example.test'); insert into profiles (id) values ('${userA}'), ('${userB}');`);
    repository = createDrizzleLexiconCorpusRepository(database as unknown as Database);
  });

  afterEach(async () => { await client.close(); });

  it("deduplicates indexed forms and counts occurrences once", async () => {
    await repository.indexLexeme({ lemma: "comer", normalizedLemma: "comer", lemmaStatus: "verified", partOfSpeech: "verb", form: "comiendo", normalizedForm: "comiendo", reference }, "Fixture", "article");
    await repository.indexLexeme({ lemma: "comer", normalizedLemma: "comer", lemmaStatus: "verified", partOfSpeech: "verb", form: "comiendo", normalizedForm: "comiendo", reference: { ...reference, position: { kind: "text", paragraphId: "p1", segmentIndex: 1 } } }, "Fixture", "article");
    const page = await repository.listVocabulary(userA, { page: 1, pageSize: 24 });
    expect(page).toMatchObject({ total: 1, items: [{ lemma: "comer", forms: ["comiendo"], occurrenceCount: 2 }] });
    expect((await repository.listVocabulary(userA, { search: "comiendo", page: 1, pageSize: 24 })).items).toHaveLength(1);
  });

  it("excludes withdrawn or orphaned occurrences from shelves and counts", async () => {
    const comerId = await repository.indexLexeme({ lemma: "comer", normalizedLemma: "comer", lemmaStatus: "verified", partOfSpeech: "verb", form: "comer", normalizedForm: "comer", reference }, "Published", "article");
    await repository.indexLexeme({ lemma: "comer", normalizedLemma: "comer", lemmaStatus: "verified", partOfSpeech: "verb", form: "comer", normalizedForm: "comer", reference: { ...reference, document: { kind: "article", stableKey: "article.withdrawn", version: 1 }, position: { kind: "text", paragraphId: "hidden", segmentIndex: 0 } } }, "Withdrawn", "article");
    await repository.indexLexeme({ lemma: "oculto", normalizedLemma: "oculto", lemmaStatus: "verified", partOfSpeech: "adjective", form: "oculto", normalizedForm: "oculto", reference: { ...reference, document: { kind: "article", stableKey: "article.withdrawn", version: 1 }, position: { kind: "text", paragraphId: "hidden", segmentIndex: 1 } } }, "Withdrawn", "article");

    await expect(repository.listVocabulary(userA, { page: 1, pageSize: 24 })).resolves.toMatchObject({ total: 1, items: [{ lemma: "comer", occurrenceCount: 1 }] });
    await expect(repository.listVocabulary(userA, { search: "oculto", page: 1, pageSize: 24 })).resolves.toMatchObject({ total: 0, items: [] });
    await expect(repository.searchCorpus(userA, { entryKind: "lexeme", entryId: comerId, page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 1, items: [{ sourceTitle: "Published" }] });
  });

  it("keeps private phrases pending and isolates them from other users", async () => {
    await repository.indexPhrase({ expression: "mi frase", normalizedExpression: "mi frase", ownerUserId: userA, reference }, "Private", "manual");
    await repository.indexPhrase({ expression: "frase pública", normalizedExpression: "frase publica", reference }, "Public", "article");
    expect((await repository.listPhrases(userA, { page: 1, pageSize: 24 })).items.map((item) => item.expression).sort()).toEqual(["frase pública", "mi frase"].sort());
    expect((await repository.listPhrases(userB, { page: 1, pageSize: 24 })).items.map((item) => item.expression)).toEqual(["frase pública"]);
  });

  it("projects one visible representative occurrence without exposing hidden sources", async () => {
    await repository.indexPhrase({ expression: "frase pública", normalizedExpression: "frase publica", reference }, "Public", "article");
    await repository.indexPhrase({ expression: "mi frase", normalizedExpression: "mi frase", ownerUserId: userA, reference }, "Private", "manual");
    const [item] = (await repository.listPhrases(userA, { page: 1, pageSize: 24 })).items;
    expect(item).toMatchObject({
      expression: "frase pública",
      scope: "public",
      occurrenceCount: 1,
      representativeOccurrence: {
        keyword: "frase pública",
        sourceTitle: "Public",
        document: { kind: "article", stableKey: "article.lexicon", version: 1 },
        location: { kind: "text", paragraphId: "p1", segmentIndex: 0 },
        entryKind: "phrase",
      },
    });
    expect((await repository.listPhrases(userA, { page: 1, pageSize: 24 })).items.find((entry) => entry.expression === "mi frase")).toMatchObject({ scope: "private" });
  });

  it("applies revision compare-and-set and keeps intent private", async () => {
    const id = await repository.indexLexeme({ lemma: "comer", normalizedLemma: "comer", lemmaStatus: "verified", partOfSpeech: "verb", form: "comer", normalizedForm: "comer", reference }, "Fixture", "article");
    await expect(repository.setIntent(userA, "lexeme", id, "revisit")).resolves.toMatchObject({ revision: 1 });
    await expect(repository.setIntent(userA, "lexeme", id, "familiar", 0)).rejects.toBeInstanceOf(LexicalIntentConflictError);
    expect((await repository.listVocabulary(userB, { page: 1, pageSize: 24 })).items[0]?.intent).toBeNull();
  });

  it("applies vocabulary filters before pagination and reports the filtered total", async () => {
    const revisitId = await repository.indexLexeme({ lemma: "comer", normalizedLemma: "comer", lemmaStatus: "verified", partOfSpeech: "verb", form: "comer", normalizedForm: "comer", reference }, "Fixture", "article");
    await repository.indexLexeme({ lemma: "casa", normalizedLemma: "casa", lemmaStatus: "pending", partOfSpeech: "noun", form: "casa", normalizedForm: "casa", reference: { ...reference, position: { kind: "text", paragraphId: "p2", segmentIndex: 1 } } }, "Fixture", "article");
    await repository.setIntent(userA, "lexeme", revisitId, "revisit");

    await expect(repository.listVocabulary(userA, { intent: "revisit", page: 1, pageSize: 1 })).resolves.toMatchObject({ total: 1, items: [{ lemma: "comer" }] });
    await expect(repository.listVocabulary(userA, { intent: "unmarked", lemmaStatus: "pending", page: 1, pageSize: 1 })).resolves.toMatchObject({ total: 1, items: [{ lemma: "casa" }] });
  });

  it("filters phrases by learning metadata before pagination", async () => {
    await repository.indexPhrase({ expression: "¿Qué tal?", normalizedExpression: "que tal", pragmaticPurpose: "saludo", register: "neutral", region: "es-ES", cefr: "A2", variant: "¿Cómo va?", normalizedVariant: "como va", reference }, "Fixture", "article");
    await repository.indexPhrase({ expression: "Le agradecería", normalizedExpression: "le agradeceria", pragmaticPurpose: "petición", register: "formal", region: "global", cefr: "B1", reference: { ...reference, position: { kind: "text", paragraphId: "p3", segmentIndex: 2 } } }, "Fixture", "article");

    await expect(repository.listPhrases(userA, { pragmaticPurpose: "SALUDO", register: "NEUTRAL", region: "es-es", cefr: "A2", page: 1, pageSize: 1 })).resolves.toMatchObject({ total: 1, items: [{ expression: "¿Qué tal?" }] });
    await expect(repository.listPhrases(userA, { search: "como va", page: 1, pageSize: 1 })).resolves.toMatchObject({ total: 1, items: [{ expression: "¿Qué tal?" }] });
  });

  it("browses visible phrase clusters across article, video, and podcast contexts", async () => {
    const videoId = "30000000-0000-4000-8000-000000000003";
    const podcastId = "30000000-0000-4000-8000-000000000004";
    await client.exec(`
      insert into media_items (id, stable_key, kind) values ('${videoId}', 'media.video', 'video'), ('${podcastId}', 'media.podcast', 'podcast');
      insert into media_versions (media_item_id, version, status, copyright_status) values ('${videoId}', 1, 'published', 'cleared'), ('${podcastId}', 1, 'published', 'cleared');
    `);
    const phrase = "por favor";
    await repository.indexPhrase({ expression: phrase, normalizedExpression: phrase, reference }, "Article source", "article");
    await repository.indexPhrase({ expression: phrase, normalizedExpression: phrase, reference: { ...reference, document: { kind: "media", stableKey: "media.video", version: 1 }, position: { kind: "media", startMs: 1_000, endMs: 2_000, segmentIndex: 0 } } }, "Video source", "video");
    await repository.indexPhrase({ expression: phrase, normalizedExpression: phrase, reference: { ...reference, document: { kind: "media", stableKey: "media.podcast", version: 1 }, position: { kind: "media", startMs: 3_000, endMs: 4_000, segmentIndex: 1 } } }, "Podcast source", "podcast");

    const page = await repository.listCorpusClusters(userA, { page: 1, pageSize: 8 });
    expect(page).toMatchObject({ total: 1, items: [{ expression: phrase, contentKinds: ["article", "video", "podcast"] }] });
    expect(page.items[0]?.contexts.map((context) => context.contentKind).sort()).toEqual(["article", "podcast", "video"]);
  });

  it("does not expose private phrases or withdrawn sources in browse clusters", async () => {
    await repository.indexPhrase({ expression: "mi privada", normalizedExpression: "mi privada", ownerUserId: userA, reference }, "Private", "manual");
    await repository.indexPhrase({ expression: "oculta", normalizedExpression: "oculta", reference: { ...reference, document: { kind: "article", stableKey: "article.withdrawn", version: 1 } } }, "Withdrawn", "article");
    await expect(repository.listCorpusClusters(userB, { page: 1, pageSize: 8 })).resolves.toMatchObject({ total: 0, items: [] });
    await expect(repository.listCorpusClusters(userA, { query: "oculta", page: 1, pageSize: 8 })).resolves.toMatchObject({ total: 0, items: [] });
  });

  it("hides restricted and other-user generated article occurrences from the formal index", async () => {
    const restrictedArticleId = "30000000-0000-4000-8000-000000000005";
    const generatedArticleId = "30000000-0000-4000-8000-000000000006";
    await client.exec(`
      insert into articles (id, stable_key) values
        ('${restrictedArticleId}', 'article.restricted'),
        ('${generatedArticleId}', 'article.generated');
      insert into article_sources (id, copyright_status) values
        ('40000000-0000-4000-8000-000000000005', 'restricted'),
        ('40000000-0000-4000-8000-000000000006', 'cleared');
      insert into article_versions (id, article_id, source_id, version, status) values
        ('50000000-0000-4000-8000-000000000005', '${restrictedArticleId}', '40000000-0000-4000-8000-000000000005', 1, 'published'),
        ('50000000-0000-4000-8000-000000000006', '${generatedArticleId}', '40000000-0000-4000-8000-000000000006', 1, 'published');
      insert into user_generated_articles (id, article_version_id, user_id) values
        ('60000000-0000-4000-8000-000000000006', '50000000-0000-4000-8000-000000000006', '${userA}');
    `);
    await repository.indexPhrase({ expression: "fuente restringida", normalizedExpression: "fuente restringida", reference: { ...reference, document: { kind: "article", stableKey: "article.restricted", version: 1 } } }, "Restricted", "article");
    await repository.indexPhrase({ expression: "historia privada", normalizedExpression: "historia privada", ownerUserId: userA, reference: { ...reference, document: { kind: "article", stableKey: "article.generated", version: 1 } } }, "Private", "article");

    await expect(repository.listPhrases(userB, { page: 1, pageSize: 24 })).resolves.toMatchObject({ total: 0, items: [] });
    await expect(repository.listPhrases(userA, { page: 1, pageSize: 24 })).resolves.toMatchObject({ total: 1, items: [{ expression: "historia privada" }] });
    await expect(repository.searchCorpus(userB, { query: "historia privada", page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 0, items: [] });
    await expect(repository.searchCorpus(userA, { query: "historia privada", page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 1, items: [{ sourceTitle: "Private" }] });
    await expect(repository.searchCorpus(userA, { query: "fuente restringida", page: 1, pageSize: 20 })).resolves.toMatchObject({ total: 0, items: [] });
  });
});
