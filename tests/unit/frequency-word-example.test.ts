// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contentFrequencyWords } from "@/src/modules/lexicon-corpus/domain/frequency-word-list";
import { createDrizzleLexiconCorpusRepository } from "@/src/modules/lexicon-corpus/repositories";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

// The shelf's inline example used to come from `corpus_occurrences`, a table the
// lexicon pipeline has never populated, so every card showed a correct count and
// no example. Counts and examples now come from one scan of the same
// `source_texts` set — the published media versions and published/cleared
// article versions — which is what these tests pin: whatever the counts can see,
// the example can see, and nothing else.

const userId = "00000000-0000-4000-8000-0000000000a1";
const publishedMediaVersion = "40000000-0000-4000-8000-000000000301";
const draftMediaVersion = "40000000-0000-4000-8000-000000000302";
const unclearedMediaVersion = "40000000-0000-4000-8000-000000000303";
const clearedArticleVersion = "40000000-0000-4000-8000-000000000304";
const unclearedArticleVersion = "40000000-0000-4000-8000-000000000305";
const generatedArticleVersion = "40000000-0000-4000-8000-000000000306";

const publishedTitle = "Podcast publicado";
const clearestSentence = "La casa de Pablo es grande.";
// Deliberately long surroundings, to exercise the 180-character clip.
const longBefore = Array.from({ length: 20 }, () => "Antes").join(" ");
const longAfter = Array.from({ length: 20 }, () => "Despues").join(" ");

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

/**
 * The production postgres-js driver returns plain rows from `execute()`, while
 * drizzle's PGlite driver returns the whole `{ rows, fields }` result there.
 * Only that shape is unwrapped; every statement still runs unchanged against
 * the real PostgreSQL engine.
 */
function pgliteDatabase(database: PGlite, logged: string[]): Database {
  const client = drizzle(database, { schema, logger: { logQuery: (query: string) => { logged.push(query); } } });
  return new Proxy(client, {
    get(target, property) {
      if (property === "execute") {
        return async (query: unknown) => {
          const result = await target.execute(query as never);
          return Array.isArray(result) ? result : (result as unknown as { rows: unknown[] }).rows;
        };
      }
      const value = Reflect.get(target, property) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  }) as unknown as Database;
}

function mediaReference(stableKey: string, segmentIndex: number, surface: string, contextBefore: string, contextAfter: string) {
  return {
    document: { kind: "media" as const, stableKey, version: 1 },
    position: { kind: "media" as const, startMs: segmentIndex * 1_000, endMs: segmentIndex * 1_000 + 900, segmentIndex },
    sourceText: surface,
    contextBefore,
    contextAfter,
  };
}

describe("frequency word example", () => {
  let client: PGlite;
  let logged: string[];
  let repository: ReturnType<typeof createDrizzleLexiconCorpusRepository>;

  beforeEach(async () => {
    // This suite pins the live corpus scan: one cold statement, carrying the
    // visibility predicate. The materialised fast path (the production default)
    // is covered by tests/database/corpus-form-frequency-materialisation.test.ts.
    process.env.LEXICON_FREQUENCY_SOURCE = "live";
    client = new PGlite();
    logged = [];
    await client.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    await client.exec(await migration("0000_big_phalanx.sql"));
    await client.exec(await migration("0021_shallow_killmonger.sql"));
    await client.exec(await migration("0037_migration_reconcile.sql"));
    // The published/withdrawn source tables are outside this baseline, so they are
    // stubbed with the columns the corpus queries actually read.
    await client.exec(`
      create table articles (id uuid primary key, stable_key text not null unique);
      create table article_versions (id uuid primary key, article_id uuid not null, version integer not null, status text not null, title text not null, source_id uuid);
      create table article_sources (id uuid primary key, copyright_status text not null);
      create table article_segments (id uuid primary key, article_version_id uuid not null, source_text text not null, position integer not null);
      create table user_generated_articles (article_version_id uuid primary key);
      create table media_items (id uuid primary key, stable_key text not null unique);
      create table media_versions (id uuid primary key, media_item_id uuid not null, version integer not null, status text not null, copyright_status text not null, title text not null);
      create table media_segments (id uuid primary key, media_version_id uuid not null, segment_index integer not null, source_text text not null, translation text, review_status text not null);
      insert into media_items (id, stable_key) values
        ('50000000-0000-4000-8000-000000000301', 'media.published'),
        ('50000000-0000-4000-8000-000000000302', 'media.draft'),
        ('50000000-0000-4000-8000-000000000303', 'media.uncleared');
      insert into media_versions (id, media_item_id, version, status, copyright_status, title) values
        ('${publishedMediaVersion}', '50000000-0000-4000-8000-000000000301', 1, 'published', 'cleared', '${publishedTitle}'),
        ('${draftMediaVersion}', '50000000-0000-4000-8000-000000000302', 1, 'draft', 'cleared', 'Borrador'),
        ('${unclearedMediaVersion}', '50000000-0000-4000-8000-000000000303', 1, 'published', 'unverified', 'Sin licencia');
      insert into media_segments (id, media_version_id, segment_index, source_text, translation, review_status) values
        ('60000000-0000-4000-8000-000000000301', '${publishedMediaVersion}', 0, '${clearestSentence}', null, 'approved'),
        ('60000000-0000-4000-8000-000000000302', '${publishedMediaVersion}', 1, '${longBefore} parque ${longAfter}', null, 'approved'),
        ('60000000-0000-4000-8000-000000000303', '${draftMediaVersion}', 0, 'Un borrador secreto sobre el secreto.', null, 'approved'),
        ('60000000-0000-4000-8000-000000000304', '${unclearedMediaVersion}', 0, 'Sin licencia hablamos de la cazadora.', null, 'approved');
      insert into articles (id, stable_key) values
        ('70000000-0000-4000-8000-000000000301', 'article.cleared'),
        ('70000000-0000-4000-8000-000000000302', 'article.uncleared'),
        ('70000000-0000-4000-8000-000000000303', 'article.generated');
      insert into article_sources (id, copyright_status) values
        ('80000000-0000-4000-8000-000000000301', 'cleared'),
        ('80000000-0000-4000-8000-000000000302', 'unverified');
      insert into article_versions (id, article_id, version, status, title, source_id) values
        ('${clearedArticleVersion}', '70000000-0000-4000-8000-000000000301', 1, 'published', 'Artículo con licencia', '80000000-0000-4000-8000-000000000301'),
        ('${unclearedArticleVersion}', '70000000-0000-4000-8000-000000000302', 1, 'published', 'Artículo sin licencia', '80000000-0000-4000-8000-000000000302'),
        ('${generatedArticleVersion}', '70000000-0000-4000-8000-000000000303', 1, 'published', 'Historia privada', '80000000-0000-4000-8000-000000000301');
      insert into user_generated_articles (article_version_id) values ('${generatedArticleVersion}');
      insert into article_segments (id, article_version_id, source_text, position) values
        ('90000000-0000-4000-8000-000000000301', '${clearedArticleVersion}', 'El arquero del pueblo entrenaba al amanecer.', 0),
        ('90000000-0000-4000-8000-000000000302', '${unclearedArticleVersion}', 'El barranco sin licencia era peligroso.', 0),
        ('90000000-0000-4000-8000-000000000303', '${generatedArticleVersion}', 'Mi historia privada habla de la abundancia.', 0);
      insert into auth.users (id, email) values ('${userId}', 'a@example.test');
      insert into profiles (id) values ('${userId}');
    `);
    repository = createDrizzleLexiconCorpusRepository(pgliteDatabase(client, logged));

    // `corpus_occurrences` rows that must NOT be the example source any more: the
    // table is empty in production, and the shelf no longer reads it.
    await repository.indexLexeme(
      { lemma: "casa", normalizedLemma: "casa", lemmaStatus: "verified", partOfSpeech: "noun", form: "casa", normalizedForm: "casa", reference: mediaReference("media.published", 0, "casa", "OCURRENCIA", "NO-DEBE-USARSE") },
      publishedTitle,
      "media",
    );
    await repository.indexLexeme(
      { lemma: "feliz", normalizedLemma: "feliz", lemmaStatus: "pending", partOfSpeech: "adjective", form: "feliz", normalizedForm: "feliz", reference: mediaReference("media.draft", 0, "feliz", "TEXTO-PRIVADO", "NO-DEBE-VERSE") },
      "Borrador",
      "media",
    );
  });

  afterEach(async () => { delete process.env.LEXICON_FREQUENCY_SOURCE; await client.close(); });

  function shelf(page: number, pageSize: number, search?: string) {
    return repository.listFrequencyWords(search === undefined ? { page, pageSize } : { page, pageSize, search });
  }

  async function shelfWord(word: string) {
    const page = await shelf(1, 20, word);
    return page.items.find((item) => item.normalizedWord === word);
  }

  it("takes the example from the published segment, not from corpus_occurrences", async () => {
    const casa = await shelfWord("casa");
    expect(casa).toMatchObject({ occurrenceCount: 1, context: clearestSentence, sourceTitle: publishedTitle });
    // The occurrence row for `casa` carries this text; it must never be shown.
    expect(casa?.context).not.toContain("OCURRENCIA");
    expect(casa?.context).not.toContain("NO-DEBE-USARSE");
  });

  it("never exposes a draft, uncleared or user-generated source", async () => {
    // Draft media, uncleared media, uncleared article and a generated article all
    // hold these words; none of them is in the set the counts are counted from.
    expect(await shelfWord("secreto")).toMatchObject({ occurrenceCount: 0, context: null, sourceTitle: null });
    expect(await shelfWord("cazadora")).toMatchObject({ occurrenceCount: 0, context: null, sourceTitle: null });
    expect(await shelfWord("barranco")).toMatchObject({ occurrenceCount: 0, context: null, sourceTitle: null });
    expect(await shelfWord("abundancia")).toMatchObject({ occurrenceCount: 0, context: null, sourceTitle: null });
    expect(await shelfWord("feliz")).toMatchObject({ occurrenceCount: 0, context: null, sourceTitle: null });
  });

  it("shows a published article example as well as a media one", async () => {
    const arquero = await shelfWord("arquero");
    expect(arquero?.context).toContain("arquero");
    expect(arquero?.sourceTitle).toBe("Artículo con licencia");
    expect(arquero?.occurrenceCount).toBe(1);
  });

  it("clips long contexts around the word and keeps the keyword whole", async () => {
    const parque = await shelfWord("parque");
    const context = parque?.context ?? "";
    expect(context).toContain("parque");
    expect(context.startsWith("…")).toBe(true);
    expect(context.endsWith("…")).toBe(true);
    expect(context.length).toBeLessThanOrEqual(180);
    expect(parque?.sourceTitle).toBe(publishedTitle);
  });

  it("keeps null for a reference word the corpus never shows, without failing the page", async () => {
    expect(await shelfWord("neurociencia")).toMatchObject({ occurrenceCount: 0, context: null, sourceTitle: null });
    const page = await shelf(1, 25);
    expect(page.items).toHaveLength(25);
    expect(page.total).toBe(contentFrequencyWords().length);
  });

  it("costs one query cold and none warm, whatever the page size", async () => {
    // A fresh module registry: earlier tests in this file already warmed the
    // process-level snapshot cache, and "cold" is the property being pinned.
    vi.resetModules();
    const fresh = await import("@/src/modules/lexicon-corpus/repositories");
    const coldRepository = fresh.createDrizzleLexiconCorpusRepository(pgliteDatabase(client, logged));

    // The fixtures above already indexed occurrences through the same logger.
    const setup = logged.length;
    await coldRepository.listFrequencyWords({ page: 1, pageSize: 25 });
    expect(logged.length - setup).toBe(1);

    const wideStart = logged.length;
    await coldRepository.listFrequencyWords({ page: 1, pageSize: 50 });
    const wide = logged.length - wideStart;
    const narrowStart = logged.length;
    await coldRepository.listFrequencyWords({ page: 1, pageSize: 5 });
    const narrow = logged.length - narrowStart;
    // Examples and counts are facts of the same cached snapshot: a page never
    // costs a query per word, and a warm page costs none at all.
    expect(wide).toBe(0);
    expect(narrow).toBe(0);

    // The one cold statement carries the same visibility predicate as the counts.
    const snapshotQuery = logged[setup] ?? "";
    expect(snapshotQuery).toContain("published");
    expect(snapshotQuery).toContain("cleared");
    expect(snapshotQuery).toContain("user_generated_articles");
  });
});
