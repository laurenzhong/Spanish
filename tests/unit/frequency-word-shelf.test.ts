// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { contentFrequencyWords, searchContentFrequencyWords } from "@/src/modules/lexicon-corpus/domain/frequency-word-list";
import { createDrizzleLexiconCorpusRepository } from "@/src/modules/lexicon-corpus/repositories";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

// The shelf is the committed reference list (function words removed, reference
// order kept) enriched with our own corpus facts. These tests run the real
// repository against a real PostgreSQL engine: the seeded corpus deliberately
// gives a low-ranked word a much higher count than the top-ranked one, so an
// implementation that re-sorts by our own counts fails here.

const userId = "00000000-0000-4000-8000-0000000000a1";
const publishedVersionId = "40000000-0000-4000-8000-000000000201";
const withdrawnVersionId = "40000000-0000-4000-8000-000000000202";
const publishedTitle = "Podcast publicado";

// `ser` (reference rank 4) appears once; `vez` (rank 55) appears five times;
// `casa` (rank 95) three times. Function words are seeded heavily on purpose.
const approvedSegments = [
  "Ser uno mismo es difícil.",
  "La vez que vino.",
  "La vez que vino.",
  "La vez que vino.",
  "La vez que vino.",
  "La vez que vino.",
  "Mi casa y tu casa son casa.",
  "Aquí está el parque.",
  "Café con leche.",
];

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

describe("frequency word shelf", () => {
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
    // The published/withdrawn source tables are outside this baseline, so they
    // are stubbed with the columns the corpus queries actually read.
    const segmentRows = approvedSegments.map((text, index) => `('60000000-0000-4000-8000-0000000002${String(index).padStart(2, "0")}', '${publishedVersionId}', ${index}, '${text}', null, 'approved')`).join(",\n        ");
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
        ('50000000-0000-4000-8000-000000000201', 'media.published'),
        ('50000000-0000-4000-8000-000000000202', 'media.withdrawn');
      insert into media_versions (id, media_item_id, version, status, copyright_status, title) values
        ('${publishedVersionId}', '50000000-0000-4000-8000-000000000201', 1, 'published', 'cleared', '${publishedTitle}'),
        ('${withdrawnVersionId}', '50000000-0000-4000-8000-000000000202', 1, 'draft', 'unverified', 'Podcast retirado');
      insert into media_segments (id, media_version_id, segment_index, source_text, translation, review_status) values
        ${segmentRows},
        ('60000000-0000-4000-8000-000000000299', '${withdrawnVersionId}', 0, 'El parque secreto sigue cerrado.', null, 'approved');
      insert into auth.users (id, email) values ('${userId}', 'a@example.test');
      insert into profiles (id) values ('${userId}');
    `);
    repository = createDrizzleLexiconCorpusRepository(pgliteDatabase(client, logged));

    // Visible occurrences: `ser` and `casa` carry a context; `parque` only ever
    // appears in the withdrawn document, so it must stay context-free.
    await repository.indexLexeme(
      { lemma: "ser", normalizedLemma: "ser", lemmaStatus: "verified", partOfSpeech: "verb", form: "ser", normalizedForm: "ser", reference: mediaReference("media.published", 0, "ser", "", "uno mismo es difícil.") },
      publishedTitle,
      "media",
    );
    await repository.indexLexeme(
      { lemma: "casa", normalizedLemma: "casa", lemmaStatus: "verified", partOfSpeech: "noun", form: "casa", normalizedForm: "casa", reference: mediaReference("media.published", 6, "casa", "Mi", "y tu casa son casa.") },
      publishedTitle,
      "media",
    );
    await repository.indexLexeme(
      { lemma: "parque", normalizedLemma: "parque", lemmaStatus: "pending", partOfSpeech: "noun", form: "parque", normalizedForm: "parque", reference: mediaReference("media.withdrawn", 0, "parque", "El", "secreto sigue cerrado.") },
      "Podcast retirado",
      "media",
    );
  });

  afterEach(async () => { delete process.env.LEXICON_FREQUENCY_SOURCE; await client.close(); });

  function shelf(page: number, pageSize: number, search?: string) {
    return repository.listFrequencyWords(search === undefined ? { page, pageSize } : { page, pageSize, search });
  }

  function rankedWords(): readonly string[] {
    return contentFrequencyWords().map((entry) => entry.word);
  }

  it("bounds the queries per page instead of one query per word", async () => {
    const coldStart = logged.length;
    await shelf(1, 60);
    // One statement builds counts and examples together; never 60 queries.
    expect(logged.length - coldStart).toBe(1);

    const wideStart = logged.length;
    await shelf(1, 60);
    const wide = logged.length - wideStart;
    const narrowStart = logged.length;
    await shelf(1, 5);
    const narrow = logged.length - narrowStart;
    // Both facts come from the same cached snapshot, so a warm page costs nothing
    // at all — stronger than the one batched query this used to require.
    expect(wide).toBe(0);
    expect(narrow).toBe(0);
  });

  it("orders by reference rank, not by our own occurrence counts", async () => {
    const page = await shelf(1, 60);
    expect(page.items.map((item) => item.word)).toEqual(rankedWords().slice(0, 60));
    expect(page.items[0]?.word).toBe("ser");

    const ser = page.items.find((item) => item.word === "ser");
    const vez = page.items.find((item) => item.word === "vez");
    // `vez` is far more frequent in this corpus and still ranks behind `ser`,
    // because the order comes from the reference list, not from our counts.
    expect(ser?.occurrenceCount).toBe(1);
    expect(vez?.occurrenceCount).toBe(5);
    expect(page.items.findIndex((item) => item.word === "ser")).toBeLessThan(page.items.findIndex((item) => item.word === "vez"));
  });

  it("never shows function words, even when the corpus is full of them", async () => {
    const page = await shelf(1, 60);
    const shown = page.items.map((item) => item.word);
    for (const word of ["el", "la", "que", "uno", "mi", "tu", "y", "con", "es"]) {
      expect(shown, `${word} is grammar and must not reach the shelf`).not.toContain(word);
    }
    const all = rankedWords();
    expect(all).not.toContain("que");
    expect(all).not.toContain("el");
  });

  it("reaches the whole reference list through pagination", async () => {
    const first = await shelf(1, 10);
    expect(first.total).toBe(contentFrequencyWords().length);
    expect(first.total).toBeGreaterThan(600);

    const second = await shelf(2, 10);
    expect(second.items.map((item) => item.word)).toEqual(rankedWords().slice(10, 20));

    const lastPage = Math.ceil(first.total / 50);
    const last = await shelf(lastPage, 50);
    expect(last.items.at(-1)?.word).toBe("neurociencia");
  });

  it("enriches the page with our counts and one visible example", async () => {
    const page = await shelf(1, 60);
    // The text is the published subtitle exactly as written — capitalised — not
    // the lower-cased surface a `corpus_occurrences` row used to carry.
    expect(page.items.find((item) => item.word === "ser")).toMatchObject({
      occurrenceCount: 1,
      context: "Ser uno mismo es difícil.",
      sourceTitle: publishedTitle,
    });
    expect(page.items.find((item) => item.word === "casa")).toMatchObject({
      occurrenceCount: 3,
      context: "Mi casa y tu casa son casa.",
      sourceTitle: publishedTitle,
    });
    expect(page.items.map((item) => item.id)).toHaveLength(new Set(page.items.map((item) => item.id)).size);
  });

  it("shows the published segment and never the withdrawn document's text", async () => {
    // `parque` sits deep in the reference list, so fetch the page that holds it.
    const parqueIndex = contentFrequencyWords().findIndex((entry) => entry.word === "parque");
    expect(parqueIndex).toBeGreaterThan(0);
    const pageSize = 50;
    const page = await shelf(Math.floor(parqueIndex / pageSize) + 1, pageSize);
    // `parque` has an occurrence row on a withdrawn document and a published
    // segment: the example is the published segment, never the withdrawn text.
    const parque = page.items.find((item) => item.word === "parque");
    expect(parque).toMatchObject({ occurrenceCount: 1, context: "Aquí está el parque.", sourceTitle: publishedTitle });
    expect(parque?.context).not.toContain("secreto");

    const lastPage = Math.ceil(page.total / pageSize);
    const last = await shelf(lastPage, pageSize);
    // A reference word our published corpus never shows keeps `null` and still
    // does not fail the page.
    expect(last.items.find((item) => item.word === "neurociencia")).toMatchObject({ occurrenceCount: 0, context: null, sourceTitle: null });
  });

  it("searches the reference list and keeps its order", async () => {
    const expected = searchContentFrequencyWords("aqui");
    const searched = await shelf(1, 20, "aqui");
    expect(searched.total).toBe(expected.length);
    expect(searched.total).toBeGreaterThan(0);
    expect(searched.total).toBeLessThan(contentFrequencyWords().length);
    expect(searched.items.map((item) => item.word)).toEqual(expected.slice(0, 20).map((entry) => entry.word));
    expect(searched.items.map((item) => item.word)).toContain("aquí");
  });
});
