// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LEXICON_FREQUENCY_SOURCE_ENV_KEY,
  MATERIALISED_FREQUENCY_MAX_AGE_MS,
  loadFormFrequencyRows,
  loadLiveFormFrequencyRows,
  readCorpusFormFrequencyState,
  readMaterialisedFormFrequencyRows,
  refreshCorpusFormFrequency,
  visibleCorpusFormCtes,
  wantedFormList,
} from "@/src/modules/lexicon-corpus/repositories/corpus-form-frequency";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

/**
 * The materialised form-frequency path.
 *
 * Three properties matter here, in this order:
 *
 * 1. **Equality.** A materialised page must render exactly what the live scan
 *    rendered — same counts, same example — or the optimisation changed the
 *    product.
 * 2. **One visibility predicate.** Both paths must include and exclude exactly
 *    the same sources. The refresh and the live query are built from one shared
 *    CTE, and the cases below prove the behaviour on both paths rather than
 *    trusting that fact; the drift guard pins the shared fragment into both
 *    statements.
 * 3. **Honest failure.** Never refreshed, emptied, stale past the cap, or a
 *    database that predates the migration must all fall back to the live scan
 *    (correct, slower) and must never report zero occurrences.
 *
 * The schema comes from the real migration artifact, as the production database
 * got it.
 */

const repositoriesDir = path.join(process.cwd(), "src", "modules", "lexicon-corpus", "repositories");
const NOW = new Date("2026-10-11T10:00:00.000Z");

const publishedMediaVersion = "70000000-0000-4000-8000-000000000001";
const draftMediaVersion = "70000000-0000-4000-8000-000000000002";
const clearedArticleVersion = "70000000-0000-4000-8000-000000000003";
const unclearedArticleVersion = "70000000-0000-4000-8000-000000000004";
const generatedArticleVersion = "70000000-0000-4000-8000-000000000005";

async function migrationStatements(name: string): Promise<string[]> {
  const raw = await readFile(path.join(process.cwd(), "drizzle", name), "utf8");
  return raw
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

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

describe("materialised form frequencies", () => {
  let client: PGlite;
  let logged: string[];
  let database: Database;

  async function applySchema(): Promise<void> {
    await client.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
    `);
    await client.exec(await (await readFile(path.join(process.cwd(), "drizzle", "0000_big_phalanx.sql"), "utf8")).replaceAll("--> statement-breakpoint", ""));
    await client.exec(await (await readFile(path.join(process.cwd(), "drizzle", "0021_shallow_killmonger.sql"), "utf8")).replaceAll("--> statement-breakpoint", ""));
    await client.exec(await (await readFile(path.join(process.cwd(), "drizzle", "0037_migration_reconcile.sql"), "utf8")).replaceAll("--> statement-breakpoint", ""));

    // The corpus source tables are outside that baseline, so they are stubbed
    // with the columns the visibility predicate actually reads.
    await client.exec(`
      create table articles (id uuid primary key, stable_key text not null unique);
      create table article_versions (id uuid primary key, article_id uuid not null, version integer not null, status text not null, title text not null, source_id uuid);
      create table article_sources (id uuid primary key, copyright_status text not null);
      create table article_segments (id uuid primary key, article_version_id uuid not null, source_text text not null, position integer not null);
      create table user_generated_articles (article_version_id uuid primary key);
      create table media_items (id uuid primary key, stable_key text not null unique);
      create table media_versions (id uuid primary key, media_item_id uuid not null, version integer not null, status text not null, copyright_status text not null, title text not null);
      create table media_segments (id uuid primary key, media_version_id uuid not null, segment_index integer not null, source_text text not null, translation text, review_status text not null);
    `);

    // The materialised tables arrive the way they arrived in production: the
    // migration artifact, executed statement by statement.
    for (const statement of await migrationStatements("0043_curious_magdalene.sql")) await client.exec(statement);
  }

  async function seedCorpus(): Promise<void> {
    await client.exec(`
      insert into media_items (id, stable_key) values
        ('71000000-0000-4000-8000-000000000001', 'media.published'),
        ('71000000-0000-4000-8000-000000000002', 'media.draft');
      insert into media_versions (id, media_item_id, version, status, copyright_status, title) values
        ('${publishedMediaVersion}', '71000000-0000-4000-8000-000000000001', 1, 'published', 'cleared', 'Podcast publicado'),
        ('${draftMediaVersion}', '71000000-0000-4000-8000-000000000002', 1, 'draft', 'unverified', 'Podcast en borrador');
      insert into media_segments (id, media_version_id, segment_index, source_text, translation, review_status) values
        ('72000000-0000-4000-8000-000000000001', '${publishedMediaVersion}', 0, 'Casa con parque.', null, 'approved'),
        ('72000000-0000-4000-8000-000000000002', '${publishedMediaVersion}', 1, 'La casa es grande.', null, 'approved'),
        ('72000000-0000-4000-8000-000000000003', '${publishedMediaVersion}', 2, 'Pendiente secreto.', null, 'pending'),
        ('72000000-0000-4000-8000-000000000004', '${draftMediaVersion}', 0, 'Secreto del borrador.', null, 'approved');

      insert into article_sources (id, copyright_status) values
        ('73000000-0000-4000-8000-000000000001', 'cleared'),
        ('73000000-0000-4000-8000-000000000002', 'unverified');
      insert into articles (id, stable_key) values
        ('74000000-0000-4000-8000-000000000001', 'article.cleared'),
        ('74000000-0000-4000-8000-000000000002', 'article.uncleared'),
        ('74000000-0000-4000-8000-000000000003', 'article.generated');
      insert into article_versions (id, article_id, version, status, title, source_id) values
        ('${clearedArticleVersion}', '74000000-0000-4000-8000-000000000001', 1, 'published', 'Artículo con derechos', '73000000-0000-4000-8000-000000000001'),
        ('${unclearedArticleVersion}', '74000000-0000-4000-8000-000000000002', 1, 'published', 'Artículo sin derechos', '73000000-0000-4000-8000-000000000002'),
        ('${generatedArticleVersion}', '74000000-0000-4000-8000-000000000003', 1, 'published', 'Artículo generado', '73000000-0000-4000-8000-000000000001');
      insert into article_segments (id, article_version_id, source_text, position) values
        ('75000000-0000-4000-8000-000000000001', '${clearedArticleVersion}', 'Casa del artículo feliz.', 0),
        ('75000000-0000-4000-8000-000000000002', '${unclearedArticleVersion}', 'Secreto borrador.', 0),
        ('75000000-0000-4000-8000-000000000003', '${generatedArticleVersion}', 'Usuario secreto.', 0);
      insert into user_generated_articles (article_version_id) values ('${generatedArticleVersion}');
    `);
  }

  /** A cold repository in a fresh module registry, so the process cache is empty. */
  async function coldRepository(source: "materialised" | "live") {
    vi.resetModules();
    process.env[LEXICON_FREQUENCY_SOURCE_ENV_KEY] = source;
    const fresh = await import("@/src/modules/lexicon-corpus/repositories/drizzle-lexicon-corpus-repository");
    return fresh.createDrizzleLexiconCorpusRepository(pgliteDatabase(client, logged));
  }

  function countsOf(rows: readonly { word: string; n: number }[], word: string): number {
    return rows.find((row) => row.word === word)?.n ?? 0;
  }

  beforeEach(async () => {
    client = new PGlite();
    logged = [];
    await applySchema();
    await seedCorpus();
    database = pgliteDatabase(client, logged);
  });

  afterEach(async () => {
    delete process.env[LEXICON_FREQUENCY_SOURCE_ENV_KEY];
    vi.restoreAllMocks();
    await client.close();
  });

  it("creates the materialised tables from the real migration artifact", async () => {
    const tables = await client.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' and tablename in ('lexicon_form_frequencies','lexicon_form_frequency_state') order by tablename`,
    );
    expect(tables.rows.map((row) => row.tablename)).toEqual([
      "lexicon_form_frequencies",
      "lexicon_form_frequency_state",
    ]);
    const checks = await client.query<{ conname: string }>(
      `select conname from pg_constraint where contype = 'c' and conname like 'lexicon_form_frequenc%' order by conname`,
    );
    expect(checks.rows).toHaveLength(4);
  });

  it("materialises exactly the counts and examples the live scan produces", async () => {
    const refresh = await refreshCorpusFormFrequency(database, NOW);
    expect(refresh.forms).toBeGreaterThan(0);

    const live = await loadLiveFormFrequencyRows(database);
    const materialised = await readMaterialisedFormFrequencyRows(database, wantedFormList());
    expect(materialised.status).toBe("ok");
    if (materialised.status !== "ok") return;

    // Field by field, not just the counts: the example text and title decide
    // what the shelf renders next to the badge.
    const liveByWord = new Map(live.map((row) => [row.word, row]));
    const materialisedByWord = new Map(materialised.rows.map((row) => [row.word, row]));
    expect([...materialisedByWord.keys()].sort()).toEqual([...liveByWord.keys()].sort());
    for (const [word, row] of liveByWord) {
      const stored = materialisedByWord.get(word);
      expect(stored?.n, `count for ${word}`).toBe(row.n);
      expect(stored?.example, `example for ${word}`).toEqual(row.example);
    }
    // And the corpus facts themselves are the expected ones, so equality is not
    // two equally-wrong paths.
    expect(countsOf(live, "casa")).toBe(3);
    expect(countsOf(live, "parque")).toBe(1);

    const state = await readCorpusFormFrequencyState(database);
    expect(state?.formCount).toBe(refresh.forms);
    expect(state?.refreshedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("is idempotent: a second refresh writes the same rows, not duplicates", async () => {
    const first = await refreshCorpusFormFrequency(database, NOW);
    const before = await client.query<{ n: number }>(`select count(*)::int as n from lexicon_form_frequencies`);
    const second = await refreshCorpusFormFrequency(database, new Date(NOW.getTime() + 60_000));
    const after = await client.query<{ n: number }>(`select count(*)::int as n from lexicon_form_frequencies`);
    const stateRows = await client.query<{ n: number }>(`select count(*)::int as n from lexicon_form_frequency_state`);

    expect(second.forms).toBe(first.forms);
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect(stateRows.rows[0]?.n).toBe(1);
    expect((await readCorpusFormFrequencyState(database))?.refreshedAt.toISOString())
      .toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });

  it("keeps both paths on one visibility predicate, on the excluded sources and the included ones", async () => {
    await refreshCorpusFormFrequency(database, NOW);
    const live = await loadLiveFormFrequencyRows(database);
    const materialised = await readMaterialisedFormFrequencyRows(database, wantedFormList());
    expect(materialised.status).toBe("ok");
    if (materialised.status !== "ok") return;

    // Included: two segments of the published, cleared media version plus one of
    // the published, cleared article version. Not the draft version, not the
    // pending segment, not the uncleared article source, not the user-generated one.
    expect(countsOf(live, "casa")).toBe(3);
    expect(countsOf(materialised.rows, "casa")).toBe(3);

    // Excluded forms must not exist in the table at all — the refresh does not
    // merely count them differently, it never sees their sources.
    for (const word of ["secreto", "borrador", "usuario", "pendiente"]) {
      const stored = await readMaterialisedFormFrequencyRows(database, word);
      expect(stored.status === "ok" ? stored.rows : [], `${word} must be invisible`).toEqual([]);
      expect(countsOf(live, word), `${word} must be invisible to the live scan too`).toBe(0);
    }

    // The example the shelf renders comes from the same visible set.
    const casa = materialised.rows.find((row) => row.word === "casa");
    expect(casa?.example[0]).toBe("Casa con parque.");
    expect(casa?.example[1]).toBe("Podcast publicado");
  });

  it("serves the fast path with exactly one statement that never scans the corpus", async () => {
    await refreshCorpusFormFrequency(database, NOW);
    const repository = await coldRepository("materialised");

    const start = logged.length;
    const page = await repository.listFrequencyWords({ page: 1, pageSize: 60 });
    // Condition 1 of the slice: `toBe(1)` is a proxy for "no per-word queries",
    // and the materialised read must hold it too.
    expect(logged.length - start).toBe(1);

    const statement = logged[start] ?? "";
    expect(statement).toContain("lexicon_form_frequencies");
    // The whole point: the cold path no longer reads the 109k published segments.
    expect(statement).not.toContain("media_segments");
    expect(statement).not.toContain("article_segments");
    expect(statement).not.toContain("user_generated_articles");

    // The page itself is the materialised data, and warm pages cost nothing.
    expect(page.items.find((item) => item.word === "casa")?.occurrenceCount).toBe(3);
    const warm = logged.length;
    await repository.listFrequencyWords({ page: 2, pageSize: 5 });
    expect(logged.length - warm).toBe(0);
  });

  it("falls back to the live scan when the table was never refreshed, and never reports zero", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const repository = await coldRepository("materialised");

    const start = logged.length;
    const page = await repository.listFrequencyWords({ page: 1, pageSize: 60 });
    // Deliberate two-statement fallback: the materialised probe reports that it
    // is unusable, then the live scan produces the numbers.
    expect(logged.length - start).toBe(2);
    expect(logged[start] ?? "").toContain("lexicon_form_frequencies");
    expect(logged[start + 1] ?? "").toContain("user_generated_articles");

    expect(page.items.find((item) => item.word === "casa")?.occurrenceCount).toBe(3);
    expect(logs.mock.calls.map((call) => String(call[0])).join("\n")).toContain("never refreshed");
  });

  it("falls back when the table is empty but a refresh is on record", async () => {
    await refreshCorpusFormFrequency(database, NOW);
    // An operator truncated the rows but not the state: counts must not become zero.
    await client.exec(`delete from lexicon_form_frequencies`);
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});

    const loaded = await loadFormFrequencyRows(database, { now: NOW.getTime() + 60_000 });
    expect(loaded.source).toBe("live");
    expect(loaded.fallback).toBe("empty table");
    expect(countsOf(loaded.rows, "casa")).toBe(3);
    expect(logs.mock.calls.map((call) => String(call[0])).join("\n")).toContain("empty table");
  });

  it("stops trusting a refresh older than the documented bound", async () => {
    await refreshCorpusFormFrequency(database, NOW);
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});

    // One hour inside the cap: the table still serves.
    const insideCap = await loadFormFrequencyRows(database, {
      now: NOW.getTime() + MATERIALISED_FREQUENCY_MAX_AGE_MS - 60 * 60 * 1_000,
    });
    expect(insideCap.source).toBe("materialised");

    // Past it: the shelf goes slow rather than stale.
    const pastCap = await loadFormFrequencyRows(database, { now: NOW.getTime() + MATERIALISED_FREQUENCY_MAX_AGE_MS + 1 });
    expect(pastCap.source).toBe("live");
    expect(pastCap.fallback).toContain("stale");
    expect(countsOf(pastCap.rows, "casa")).toBe(3);
    expect(logs.mock.calls.map((call) => String(call[0])).join("\n")).toContain("stale");
  });

  it("falls back when the database predates the migration", async () => {
    const bare = new PGlite();
    try {
      const bareDatabase = pgliteDatabase(bare, []);
      const logs = vi.spyOn(console, "log").mockImplementation(() => {});
      // Only the source tables: no materialised table, no state row.
      await bare.exec(`
        create table media_items (id uuid primary key, stable_key text not null unique);
        create table media_versions (id uuid primary key, media_item_id uuid not null, version integer not null, status text not null, copyright_status text not null, title text not null);
        create table media_segments (id uuid primary key, media_version_id uuid not null, segment_index integer not null, source_text text not null, translation text, review_status text not null);
        create table articles (id uuid primary key, stable_key text not null unique);
        create table article_versions (id uuid primary key, article_id uuid not null, version integer not null, status text not null, title text not null, source_id uuid);
        create table article_sources (id uuid primary key, copyright_status text not null);
        create table article_segments (id uuid primary key, article_version_id uuid not null, source_text text not null, position integer not null);
        create table user_generated_articles (article_version_id uuid primary key);
      `);
      const loaded = await loadFormFrequencyRows(bareDatabase, { now: NOW.getTime() });
      expect(loaded.source).toBe("live");
      expect(loaded.fallback).toContain("unavailable");
      expect(logs.mock.calls.map((call) => String(call[0])).join("\n")).toContain("unavailable");
    } finally {
      await bare.close();
    }
  });

  it("pins the shared visibility fragment into both the live query and the refresh", async () => {
    // The fragment as the dialect renders it: whatever the two statements send
    // must contain this verbatim, so a hand-written predicate added to either
    // one fails here instead of silently disagreeing with the other.
    const fragment = new PgDialect().sqlToQuery(visibleCorpusFormCtes).sql;
    expect(fragment).toContain("source_texts as (");
    for (const marker of ["media_segments", "article_segments", "user_generated_articles", "published", "cleared"]) {
      expect(fragment).toContain(marker);
    }

    logged.length = 0;
    await refreshCorpusFormFrequency(database, NOW);
    // The refresh is a transaction (delete, insert, state), so pick the
    // statement that actually carries the aggregate.
    const refreshStatement = logged.find((statement) => statement.includes("source_texts as (")) ?? "";
    logged.length = 0;
    await loadLiveFormFrequencyRows(database);
    const liveStatement = logged.find((statement) => statement.includes("source_texts as (")) ?? "";

    expect(liveStatement).toContain(fragment);
    expect(refreshStatement).toContain(fragment);
  });

  it("has exactly one module feeding the materialised table", async () => {
    const { readdir, readFile: read } = await import("node:fs/promises");
    const files = (await readdir(repositoriesDir)).filter((name) => name.endsWith(".ts"));
    const feeders: string[] = [];
    for (const name of files) {
      // Comments are stripped first: mentioning the table in a doc block is not
      // feeding it, and this scan is about the SQL a module actually runs.
      const body = (await read(path.join(repositoriesDir, name), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
      if (/lexicon_form_frequencies|lexiconFormFrequencies/.test(body)) feeders.push(name);
    }
    // The table is written and read by one module; a second reader is where a
    // second visibility rule would appear.
    expect(feeders).toEqual(["corpus-form-frequency.ts"]);
  });
});
