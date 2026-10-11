// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { normalizeSpanishSurface } from "@/src/modules/lexicon-corpus/domain";
import { createDrizzleLexiconCorpusRepository } from "@/src/modules/lexicon-corpus/repositories";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

// B3 regression: the frequency shelf used to hard-code `context: null` /
// `sourceTitle: null`, so the detail panel never showed real usage. These tests
// run the repository against a real PostgreSQL engine (PGlite) instead of
// feeding the component fake rows, so they fail if the repository stops reading
// `corpus_occurrences`.
//
// The shelf is now driven by the committed reference word list (task-12), so a
// seeded word must exist in that list and can sit far beyond the first page.
// Each case therefore reaches its word the way a reader does — by searching for
// it on a small page — instead of growing the page until the position happens
// to fit. The enrichment assertions themselves are unchanged in strength.

const userId = "00000000-0000-4000-8000-0000000000a1";
const publishedVersionId = "40000000-0000-4000-8000-000000000101";
const withdrawnVersionId = "40000000-0000-4000-8000-000000000102";

const publishedTitle = "Podcast publicado";
// Approved subtitle lines, so the shelf can count these forms; the enrichment
// assertions below only use words the reference list actually contains.
const approvedSegments = [
  "La casa de Pablo es grande.",
  "La ventana está abierta y la luz entra despacio.",
  "El perro corre feliz por el parque.",
];
// Deliberately long surrounding segments, to exercise clipping.
const longBefore = Array.from({ length: 20 }, () => "Antes").join(" ");
const longAfter = Array.from({ length: 20 }, () => "Despues").join(" ");

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
}

/**
 * The production postgres-js driver returns plain rows from `execute()`, while
 * drizzle's PGlite driver returns the whole `{ rows, fields }` result there.
 * Only that shape is unwrapped here: every statement still runs unchanged
 * against the real PostgreSQL engine.
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

describe("frequency word context", () => {
  let client: PGlite;
  let logged: string[];
  let repository: ReturnType<typeof createDrizzleLexiconCorpusRepository>;

  beforeEach(async () => {
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
    // The published/withdrawn source tables are outside this baseline, so they
    // are stubbed with the columns the corpus queries actually read.
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
        ('50000000-0000-4000-8000-000000000101', 'media.published'),
        ('50000000-0000-4000-8000-000000000102', 'media.withdrawn');
      insert into media_versions (id, media_item_id, version, status, copyright_status, title) values
        ('${publishedVersionId}', '50000000-0000-4000-8000-000000000101', 1, 'published', 'cleared', '${publishedTitle}'),
        ('${withdrawnVersionId}', '50000000-0000-4000-8000-000000000102', 1, 'draft', 'unverified', 'Podcast retirado');
      insert into media_segments (id, media_version_id, segment_index, source_text, translation, review_status) values
        ('60000000-0000-4000-8000-000000000101', '${publishedVersionId}', 0, '${approvedSegments[0]}', null, 'approved'),
        ('60000000-0000-4000-8000-000000000102', '${publishedVersionId}', 1, '${approvedSegments[1]}', null, 'approved'),
        ('60000000-0000-4000-8000-000000000103', '${publishedVersionId}', 2, '${approvedSegments[2]}', null, 'approved'),
        ('60000000-0000-4000-8000-000000000104', '${withdrawnVersionId}', 0, 'Un borrador secreto con parque y casa.', null, 'approved');
      insert into auth.users (id, email) values ('${userId}', 'a@example.test');
      insert into profiles (id) values ('${userId}');
    `);
    repository = createDrizzleLexiconCorpusRepository(pgliteDatabase(client, logged));

    const published = "media.published";
    const withdrawn = "media.withdrawn";
    // Rich visible occurrence for `casa`, plus a poorer duplicate on the same
    // document: the richest one must win.
    await repository.indexLexeme(
      { lemma: "casa", normalizedLemma: "casa", lemmaStatus: "verified", partOfSpeech: "noun", form: "casa", normalizedForm: "casa", reference: mediaReference(published, 0, "casa", "La", "de Pablo es grande.") },
      publishedTitle,
      "media",
    );
    await repository.indexLexeme(
      { lemma: "casa", normalizedLemma: "casa", lemmaStatus: "verified", partOfSpeech: "noun", form: "casa", normalizedForm: "casa", reference: mediaReference(published, 9, "casa", "", "") },
      publishedTitle,
      "media",
    );
    // `secreto` only occurs in a withdrawn document, `feliz` only in a private
    // one, and `ventana` has no occurrence at all. All three are reference-list
    // words, so all three can actually appear on the shelf.
    await repository.indexLexeme(
      { lemma: "secreto", normalizedLemma: "secreto", lemmaStatus: "pending", partOfSpeech: "noun", form: "secreto", normalizedForm: "secreto", reference: mediaReference(withdrawn, 0, "secreto", "Un borrador", "con parque y casa.") },
      "Podcast retirado",
      "media",
    );
    const felizLexemeId = await repository.indexLexeme(
      { lemma: "feliz", normalizedLemma: "feliz", lemmaStatus: "pending", partOfSpeech: "adjective", form: "feliz", normalizedForm: "feliz", reference: mediaReference(published, 2, "feliz", "El perro corre", "por el parque.") },
      "Nota privada",
      "manual",
    );
    await client.exec(`update corpus_occurrences set owner_user_id = '${userId}' where lexeme_id = '${felizLexemeId}';`);
    // Long surrounding segments, to exercise clipping.
    await repository.indexLexeme(
      { lemma: "parque", normalizedLemma: "parque", lemmaStatus: "verified", partOfSpeech: "noun", form: "parque", normalizedForm: "parque", reference: mediaReference(published, 2, "parque", longBefore, longAfter) },
      publishedTitle,
      "media",
    );
  });

  afterEach(async () => { await client.close(); });

  /** A small page of the shelf, used to measure how many queries a page costs. */
  function shelfPage(pageSize: number) {
    return repository.listFrequencyWords({ page: 1, pageSize });
  }

  /**
   * Reach a seeded word the way a reader does: search for it on a small page.
   * The page stays small on purpose — growing it until a deep rank fits would
   * hide the paging property instead of exercising it.
   */
  async function shelfWord(word: string) {
    const page = await repository.listFrequencyWords({ page: 1, pageSize: 20, search: word });
    return page.items.find((item) => item.normalizedWord === normalizeSpanishSurface(word));
  }

  it("fills the representative context and source title from visible occurrences", async () => {
    expect(await shelfWord("casa")).toMatchObject({ word: "casa", context: "La casa de Pablo es grande.", sourceTitle: publishedTitle });
  });

  it("keeps null context when the only occurrences are withdrawn, private or missing", async () => {
    const secreto = await shelfWord("secreto");
    const feliz = await shelfWord("feliz");
    const ventana = await shelfWord("ventana");
    // All three really are on the shelf; only their context is withheld.
    expect(secreto).toBeDefined();
    expect(feliz).toBeDefined();
    expect(ventana).toBeDefined();
    expect(secreto).toMatchObject({ context: null, sourceTitle: null });
    expect(feliz).toMatchObject({ context: null, sourceTitle: null });
    expect(ventana).toMatchObject({ context: null, sourceTitle: null });
  });

  it("clips long contexts around the word instead of dropping them", async () => {
    const parque = await shelfWord("parque");
    const context = parque?.context ?? "";
    expect(context).toContain("parque");
    expect(context.startsWith("…")).toBe(true);
    expect(context.endsWith("…")).toBe(true);
    expect(context.length).toBeLessThanOrEqual(180);
    expect(parque?.sourceTitle).toBe(publishedTitle);
  });

  it("resolves a whole page with one query and the shared visibility predicate", async () => {
    // Warm the cached form counts, then count only the per-page lookups.
    await shelfPage(50);
    const wideStart = logged.length;
    await shelfPage(50);
    const wideQueries = logged.length - wideStart;
    const narrowStart = logged.length;
    await shelfPage(3);
    const narrowQueries = logged.length - narrowStart;

    expect(wideQueries).toBe(1);
    expect(narrowQueries).toBe(1);
    const lookup = logged[logged.length - 1] ?? "";
    expect(lookup).toContain("distinct on");
    expect(lookup).toContain("published");
    expect(lookup).toContain("cleared");
  });
});
