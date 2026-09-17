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
    await client.exec(await migration("0027_wide_puff_adder.sql"));
    await client.exec(`
      create table articles (id uuid primary key, stable_key text not null unique);
      create table article_versions (article_id uuid not null, version integer not null, status text not null);
      create table media_items (id uuid primary key, stable_key text not null unique);
      create table media_versions (media_item_id uuid not null, version integer not null, status text not null, copyright_status text not null);
      insert into articles (id, stable_key) values ('${articleId}', 'article.lexicon');
      insert into article_versions (article_id, version, status) values ('${articleId}', 1, 'published');
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
});
