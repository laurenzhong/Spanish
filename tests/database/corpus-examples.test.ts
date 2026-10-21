// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createCorpusExamplesRepository } from "@/src/modules/lexicon-corpus/repositories/corpus-examples-repository";
import { corpusExamplesQuerySchema } from "@/src/modules/lexicon-corpus/schemas/corpus-examples";
import type { Database } from "@/src/shared/db/client";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const entryId = "00000000-0000-4000-8000-000000000003";

// Deliberately model only columns this read projection needs, using the real
// content/reading/media schema names. This avoids the unrelated migration
// baseline and never opens a connection to an external database.
const tables = `
  create table articles (id uuid primary key, stable_key text not null unique);
  create table article_sources (id uuid primary key, source_name text not null, copyright_status text not null);
  create table article_versions (id uuid primary key, article_id uuid not null references articles,
    source_id uuid not null references article_sources, version integer not null, title text not null, status text not null);
  create table article_segments (id uuid primary key, article_version_id uuid not null references article_versions,
    position integer not null, source_text text not null);
  create table user_generated_articles (id uuid primary key, article_version_id uuid not null references article_versions,
    user_id uuid not null);
  create table media_items (id uuid primary key, stable_key text not null unique, kind text not null, current_version integer);
  create table media_versions (id uuid primary key, media_item_id uuid not null references media_items,
    version integer not null, title text not null, source_name text not null, status text not null, copyright_status text not null);
  create table media_segments (id uuid primary key, media_version_id uuid not null references media_versions,
    segment_index integer not null, source_text text not null, translation text,
    start_ms integer not null, end_ms integer not null, review_status text not null);
  create table corpus_occurrences (id uuid primary key, lexeme_id uuid, phrase_entry_id uuid,
    document_kind text not null, document_stable_key text not null, document_version integer not null,
    source_position jsonb not null, owner_user_id uuid);
`;

describe("corpus examples SQL projection", () => {
  let client: PGlite;
  let repository: ReturnType<typeof createCorpusExamplesRepository>;
  const list = (input: Record<string, unknown> = {}, userId = owner) => repository.list(userId, corpusExamplesQuerySchema.parse(input));

  beforeAll(async () => {
    client = new PGlite();
    await client.exec(tables);
    const database = drizzle(client);
    // Preserve genuine PostgreSQL execution; adapt only the PGlite driver's
    // { rows } envelope to the production postgres-js driver's row array.
    const executor = { execute: async (query: Parameters<typeof database.execute>[0]) => (await database.execute(query)).rows };
    repository = createCorpusExamplesRepository(executor as unknown as Pick<Database, "execute">);
  }, 30_000);
  beforeEach(async () => {
    await client.exec("truncate corpus_occurrences, user_generated_articles, article_segments, article_versions, article_sources, articles, media_segments, media_versions, media_items cascade");
  });
  afterAll(async () => { await client?.close(); });

  async function article(key: string, texts: string[], options: { version?: number; status?: string; rights?: string; userId?: string; sourceName?: string } = {}) {
    const sourceId = randomUUID();
    const versionId = randomUUID();
    const existing = await client.query<{ id: string }>("select id from articles where stable_key = $1", [key]);
    const articleId = existing.rows[0]?.id ?? randomUUID();
    if (!existing.rows.length) await client.query("insert into articles values ($1, $2)", [articleId, key]);
    await client.query("insert into article_sources values ($1, $2, $3)", [sourceId, options.sourceName ?? `Source ${key}`, options.rights ?? "cleared"]);
    await client.query("insert into article_versions values ($1, $2, $3, $4, $5, $6)", [versionId, articleId, sourceId, options.version ?? 1, `Title ${key}`, options.status ?? "published"]);
    for (const [index, text] of texts.entries()) await client.query("insert into article_segments values ($1, $2, $3, $4)", [randomUUID(), versionId, index, text]);
    if (options.userId) await client.query("insert into user_generated_articles values ($1, $2, $3)", [randomUUID(), versionId, options.userId]);
    return versionId;
  }

  async function media(key: string, texts: string[], options: { version?: number; currentVersion?: number; status?: string; rights?: string; review?: string[]; kind?: string; translations?: string[] } = {}) {
    const versionId = randomUUID();
    const existing = await client.query<{ id: string }>("select id from media_items where stable_key = $1", [key]);
    const itemId = existing.rows[0]?.id ?? randomUUID();
    if (!existing.rows.length) await client.query("insert into media_items values ($1, $2, $3, $4)", [itemId, key, options.kind ?? "podcast", options.currentVersion ?? 1]);
    await client.query("insert into media_versions values ($1, $2, $3, $4, $5, $6, $7)", [versionId, itemId, options.version ?? 1, `Title ${key}`, `Source ${key}`, options.status ?? "published", options.rights ?? "cleared"]);
    for (const [index, text] of texts.entries()) await client.query("insert into media_segments values ($1, $2, $3, $4, $5, $6, $7, $8)", [randomUUID(), versionId, index, text, options.translations?.[index] ?? null, index * 2000, (index + 1) * 2000, options.review?.[index] ?? "approved"]);
    return versionId;
  }

  it("searches complete source text even when there are no lexical occurrences", async () => {
    const complete = "Antes de salir, me gustaría tomar un café contigo para hablar de nuestros planes.";
    await article("article.complete", ["La conversación acaba de empezar.", complete, "Después iremos al mercado."]);
    expect((await client.query("select * from corpus_occurrences")).rows).toEqual([]);
    const result = await list({ query: "me gustaría" });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ text: complete, translation: null, before: "La conversación acaba de empezar.", after: "Después iremos al mercado.", sourceName: "Source article.complete", sourceTitle: "Title article.complete", document: { kind: "article", stableKey: "article.complete", version: 1 }, location: { kind: "text", paragraphId: "segment-1", segmentIndex: 1 } });
  });

  it("preserves media translation, neighboring context and actual time coordinates", async () => {
    await media("podcast.context", ["Buenos días.", "¿Te apetece un café?", "Claro, gracias."], { translations: ["早上好。", "想喝咖啡吗？", "当然，谢谢。"] });
    const result = await list({ query: "apetece" });
    expect(result.items[0]).toMatchObject({ text: "¿Te apetece un café?", translation: "想喝咖啡吗？", before: "Buenos días.", after: "Claro, gracias.", location: { kind: "media", startMs: 2000, endMs: 4000, segmentIndex: 1 } });
  });

  it("distinguishes ordered consecutive phrase matching from all words in any order", async () => {
    await article("matching", ["Me parece bien.", "Bien, eso me parece una buena idea.", "Me parece bastante bien.", "Es una buena idea."]);
    expect((await list({ query: "me parece bien" })).items.map((item) => item.location.segmentIndex)).toEqual([0]);
    expect((await list({ query: "me parece bien", match: "all" })).items.map((item) => item.location.segmentIndex)).toEqual([0, 1, 2]);
  });

  it("folds case and Spanish accents while respecting word boundaries and punctuation", async () => {
    await article("accents", ["¡CAFÉ, por favor!", "El cafe está listo.", "La cafetería está cerrada.", "Tomamos café con leche."]);
    expect((await list({ query: "café" })).items.map((item) => item.location.segmentIndex)).toEqual([0, 1, 3]);
    expect((await list({ query: "cafe por favor" })).items.map((item) => item.location.segmentIndex)).toEqual([0]);
    expect((await list({ query: "!!!" })).total).toBe(0);
  });

  it("rotates source documents and counts the entire result before stable pagination", async () => {
    await article("a", ["Café uno.", "Café dos.", "Café tres."]);
    await media("b", ["Café cuatro.", "Café cinco.", "Café seis."]);
    const first = await list({ query: "cafe", pageSize: 2 });
    const second = await list({ query: "cafe", pageSize: 2, page: 2 });
    const third = await list({ query: "cafe", pageSize: 2, page: 3 });
    for (const result of [first, second, third]) {
      expect(result.total).toBe(6);
      expect(result.items.map((item) => item.document.stableKey)).toEqual(["a", "b"]);
    }
    expect(new Set([...first.items, ...second.items, ...third.items].map((item) => item.id)).size).toBe(6);
    expect(await list({ query: "cafe", pageSize: 2 })).toEqual(first);
    expect(await list({ query: "cafe", pageSize: 2, page: 4 })).toEqual({ items: [], total: 6, page: 4, pageSize: 2 });
    expect(await list({ query: "ninguno", page: 2 })).toEqual({ items: [], total: 0, page: 2, pageSize: 12 });
  });

  it("keeps media visible when many article sources match the same query", async () => {
    for (let index = 0; index < 5; index++) await article(`article.${index}`, ["Un café."]);
    await media("podcast.one", ["Un café."]);
    await media("video.one", ["Un café."], { kind: "video" });
    const result = await list({ pageSize: 3 });
    expect(result.items.map((item) => item.contentKind)).toEqual(["article", "podcast", "video"]);
  });

  it("excludes drafts, withdrawn versions, restricted rights and unreviewed transcripts on every read", async () => {
    await article("article.ok", ["Un café visible."]);
    await article("article.draft", ["Un café borrador."], { status: "draft" });
    await article("article.withdrawn", ["Un café retirado."], { status: "archived" });
    await article("article.rights", ["Un café restringido."], { rights: "restricted" });
    await media("media.ok", ["Un café publicado."]);
    await media("media.draft", ["Un café borrador."], { status: "draft" });
    await media("media.withdrawn", ["Un café retirado."], { status: "archived" });
    await media("media.rights", ["Un café restringido."], { rights: "restricted" });
    await media("media.pending", ["Un café pendiente."], { review: ["pending"] });
    const first = await list({ query: "cafe" });
    expect(first.items.map((item) => item.document.stableKey)).toEqual(["article.ok", "media.ok"]);
    await client.exec("update article_sources set copyright_status = 'restricted'; update media_versions set status = 'archived'");
    expect((await list({ query: "cafe" })).total).toBe(0);
  });

  it("keeps private articles and all their context restricted to their actual owner", async () => {
    await article("public", ["Un café público."]);
    await article("private.a", ["Secreto de A antes.", "Un café privado para A.", "Secreto de A después."], { userId: owner });
    await article("private.b", ["Secreto de B antes.", "Un café privado para B.", "Secreto de B después."], { userId: other });
    const a = await list({ query: "cafe" });
    const b = await list({ query: "cafe" }, other);
    expect(a.items.map((item) => item.document.stableKey).sort()).toEqual(["private.a", "public"]);
    expect(b.items.map((item) => item.document.stableKey).sort()).toEqual(["private.b", "public"]);
    expect(JSON.stringify(a)).not.toContain("Secreto de B");
    expect(JSON.stringify(b)).not.toContain("Secreto de A");
    expect((await list({ stableKey: "private.b" })).total).toBe(0);
    expect(a.items.find((item) => item.document.stableKey === "public")).toMatchObject({ before: null, after: null });
  });

  it("reads only the latest published article and media currentVersion without stale-version context", async () => {
    await article("versions.article", ["Café antiguo."], { version: 1 });
    await article("versions.article", ["Café nuevo."], { version: 2 });
    await article("versions.article", ["Café borrador futuro."], { version: 3, status: "draft" });
    await media("versions.media", ["Café anterior."], { version: 1, currentVersion: 2 });
    await media("versions.media", ["Café actual."], { version: 2 });
    await media("versions.media", ["Café futuro."], { version: 3 });
    const result = await list({ query: "cafe" });
    expect(result.items.map((item) => item.text)).toEqual(["Café nuevo.", "Café actual."]);
    expect(result.items.every((item) => item.document.version === 2 && item.before === null && item.after === null)).toBe(true);
  });

  it("never includes pending subtitle content as adjacent context", async () => {
    await media("review.context", ["Información pendiente privada.", "Un café aprobado.", "Seguimos hablando.", "Otro pendiente."], { review: ["pending", "approved", "approved", "pending"] });
    const result = await list({ query: "cafe" });
    expect(result.items[0]).toMatchObject({ before: null, after: "Seguimos hablando." });
    expect(JSON.stringify(result)).not.toContain("pendiente");
  });

  it("applies content, document, source and stable-key filters to the same counted pool", async () => {
    await article("article.filter", ["Un café."], { sourceName: "Una revista" });
    await media("podcast.filter", ["Un café."]);
    await media("video.filter", ["Un café."], { kind: "video" });
    expect((await list({ contentKind: "video" })).items.map((item) => item.document.stableKey)).toEqual(["video.filter"]);
    expect((await list({ documentKind: "media" })).total).toBe(2);
    expect((await list({ sourceKind: "Una revista", stableKey: "article.filter" })).total).toBe(1);
    expect((await list({ sourceKind: "Una revista", contentKind: "podcast" })).total).toBe(0);
  });

  it("uses entry occurrences only to constrain a deep link and rechecks occurrence ownership", async () => {
    await article("entry.target", ["Un café.", "Dos cafés."]);
    await article("entry.other", ["Otro café."]);
    await client.query("insert into corpus_occurrences values ($1, $2, null, 'article', 'entry.target', 1, $3::jsonb, $4)", [randomUUID(), entryId, JSON.stringify({ kind: "text", paragraphId: "segment-1", segmentIndex: 1 }), owner]);
    expect((await list({ entryKind: "lexeme", entryId })).items.map((item) => item.text)).toEqual(["Dos cafés."]);
    expect((await list({ entryKind: "lexeme", entryId }, other)).total).toBe(0);
    expect((await list()).total).toBe(3);
  });
});
