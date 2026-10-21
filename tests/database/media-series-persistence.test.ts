// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/src/shared/db/schema";
import type { Database } from "@/src/shared/db/client";
import { createDrizzleMediaSeriesRepository } from "@/src/modules/media/repositories/drizzle-media-series-repository";
import type { SaveMediaSeriesCommand } from "@/src/modules/media/domain/media-series";

const owner = "00000000-0000-4000-8000-0000000000a1";
const other = "00000000-0000-4000-8000-0000000000a2";
function command(overrides: Partial<SaveMediaSeriesCommand> = {}): SaveMediaSeriesCommand {
  return { idempotencyKey: "series-test-create", expectedRevision: 0, title: "Las aventuras", summary: "Serie de prueba",
    kind: "video", orderMode: "ordered", status: "active", reason: "Confirmed fixture catalogue", evidence: ["https://fixture.test/programme"],
    members: [], removeStableKeys: [], fromSeriesRevisions: {}, ...overrides };
}
const member = (index: number) => ({ stableKey: `series.fixture.${index}`, position: index + 1, seasonNumber: null, episodeNumber: null,
  episodeLabel: null, evidence: ["https://fixture.test/programme"] });

describe("media series repository on PostgreSQL", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleMediaSeriesRepository>;
  beforeAll(async () => {
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = owner;
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated;");
    for (const file of ["0000_big_phalanx.sql", "0024_media_library_foundation.sql", "0025_youtube_video_publication.sql", "0026_brief_toro.sql", "0027_pale_colossus.sql", "0041_media_cefr_four_levels.sql", "0046_media_series_directory.sql"]) {
      await client.exec((await readFile(`drizzle/${file}`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    db = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id) values ('${owner}'), ('${other}'); insert into profiles (id) values ('${owner}'), ('${other}');`);
    for (let index = 0; index < 14; index++) {
      const [item] = await db.insert(schema.mediaItems).values({ stableKey: `series.fixture.${index}`, kind: index === 13 ? "podcast" : "video", currentVersion: 1 }).returning();
      const [version] = await db.insert(schema.mediaVersions).values({ mediaItemId: item.id, version: 1, title: `Episode ${index}`, sourceName: "Fixture",
        status: "published", copyrightStatus: "cleared", durationMs: 120000, contentHash: "a".repeat(64),
        publicationDate: new Date(`2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`),
        license: "licensed", attribution: "Fixture", licenseEvidence: "https://fixture.test/license" }).returning();
      await db.insert(schema.mediaAssets).values({ mediaVersionId: version.id, kind: index === 13 ? "audio" : "video", providerKey: "bunny-storage", playbackUrl: "https://fixture.b-cdn.net/media/fixture.mp4", playbackExpiresAt: new Date("2099-01-01T00:00:00Z"), availability: "available" });
      await db.insert(schema.userMediaProgress).values([{ userId: owner, mediaVersionId: version.id, lastPositionMs: 1000 }, { userId: other, mediaVersionId: version.id, lastPositionMs: 2000 }]);
    }
    repository = createDrizzleMediaSeriesRepository(db as unknown as Database);
  }, 30000);
  afterAll(async () => { delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS; await client?.close(); });

  it("creates confirmed membership atomically and replays the original result without another audit", async () => {
    const input = command({ members: Array.from({ length: 12 }, (_, index) => member(index)) });
    const first = await repository.save("series.adventures", input, owner);
    expect(first.revision).toBe(1);
    expect(await repository.save("series.adventures", input, owner)).toEqual(first);
    expect(await repository.save("series.adventures", input, owner.toUpperCase())).toEqual(first);
    expect(await db.select().from(schema.mediaSeriesChanges)).toHaveLength(1);
    await expect(repository.save("series.adventures", { ...input, title: "Changed" }, owner)).rejects.toMatchObject({ code: "MEDIA_SERIES_IDEMPOTENCY_CONFLICT" });
    expect((await repository.getSeries("series.adventures", owner)).episodeCount).toBe(12);
  });
  it("rejects non-owner writes, stale revisions, wrong kind and partial import", async () => {
    await expect(repository.save("series.denied", command(), other)).rejects.toMatchObject({ code: "CONTENT_WORKFLOW_FORBIDDEN" });
    await expect(repository.save("series.adventures", command({ idempotencyKey: "stale-revision" }), owner)).rejects.toMatchObject({ code: "MEDIA_SERIES_REVISION_CONFLICT" });
    await expect(repository.save("series.invalid", command({ members: [member(12), member(13)] }), owner)).rejects.toMatchObject({ code: "MEDIA_SERIES_MEMBERSHIP_CONFLICT" });
    expect(await db.select().from(schema.mediaSeries).where(eq(schema.mediaSeries.seriesKey, "series.invalid"))).toHaveLength(0);
  });
  it("pages bounded episodes around a late anchor, returns neighbors and isolates user progress", async () => {
    const page = await repository.listEpisodes("series.adventures", { pageSize: 3, anchorMediaKey: "series.fixture.8" }, owner);
    expect(page.items.map((item) => item.stableKey)).toEqual(["series.fixture.6", "series.fixture.7", "series.fixture.8"]);
    expect(page.anchor.previous?.stableKey).toBe("series.fixture.7");
    expect(page.anchor.next?.stableKey).toBe("series.fixture.9");
    expect(page.items.every((item) => item.progress?.lastPositionMs === 1000)).toBe(true);
    const next = await repository.listEpisodes("series.adventures", { pageSize: 3, cursor: page.nextCursor! }, other);
    expect(next.items.map((item) => item.stableKey)).toEqual(["series.fixture.9", "series.fixture.10", "series.fixture.11"]);
    expect(next.items.every((item) => item.progress?.lastPositionMs === 2000)).toBe(true);
    expect(next.hasMore).toBe(false);
  });
  it("recommends at most six same-series videos with successors first, then earlier episodes", async () => {
    const result = await repository.recommendations("series.fixture.9", owner);
    expect(result.items.map((item) => item.stableKey)).toEqual(["series.fixture.10", "series.fixture.11", "series.fixture.0", "series.fixture.1", "series.fixture.2", "series.fixture.3"]);
    expect(result.items.every((item) => item.kind === "video" && item.series?.seriesKey === "series.adventures")).toBe(true);
    expect(await repository.recommendations("series.fixture.12", owner)).toEqual({ series: null, items: [] });
    expect(await repository.recommendations("series.fixture.13", owner)).toEqual({ series: null, items: [] });
  });
  it("rejects malformed/out-of-range cursors and collisions with unchanged members without partial writes", async () => {
    for (const value of ["invalid-json", Buffer.from(JSON.stringify({ context: "a".repeat(64), offset: 2147483648 })).toString("base64url")]) {
      await expect(repository.listEpisodes("series.adventures", { pageSize: 3, cursor: value }, owner)).rejects.toMatchObject({ code: "MEDIA_SERIES_CURSOR_INVALID" });
    }
    await expect(repository.listEpisodes("series.adventures", { pageSize: 3, anchorMediaKey: "series.fixture.12" }, owner)).rejects.toMatchObject({ code: "MEDIA_SERIES_QUERY_INVALID" });
    await expect(repository.save("series.adventures", command({ idempotencyKey: "existing-position-conflict", expectedRevision: 1, members: [{ ...member(0), position: 3 }] }), owner)).rejects.toMatchObject({ code: "MEDIA_SERIES_MEMBERSHIP_CONFLICT" });
    expect((await repository.getSeries("series.adventures", owner)).revision).toBe(1);
    expect(await db.select().from(schema.mediaSeriesChanges)).toHaveLength(1);
    expect((await repository.listEpisodes("series.adventures", { pageSize: 3 }, owner)).items.map((item) => item.stableKey)).toEqual(["series.fixture.0", "series.fixture.1", "series.fixture.2"]);
  });
  it("rechecks rights, asset expiry and the current version rather than returning historical playable versions", async () => {
    const [old] = await db.select().from(schema.mediaVersions).where(eq(schema.mediaVersions.title, "Episode 11"));
    await db.update(schema.mediaVersions).set({ copyrightStatus: "restricted" }).where(eq(schema.mediaVersions.title, "Episode 10"));
    await db.update(schema.mediaAssets).set({ playbackExpiresAt: new Date("2000-01-01T00:00:00Z") }).where(eq(schema.mediaAssets.mediaVersionId, old.id));
    const [changed] = await db.select().from(schema.mediaItems).where(eq(schema.mediaItems.stableKey, "series.fixture.8"));
    await db.update(schema.mediaItems).set({ currentVersion: 2 }).where(eq(schema.mediaItems.id, changed.id));
    const page = await repository.listEpisodes("series.adventures", { pageSize: 50 }, owner);
    expect(page.series.episodeCount).toBe(9);
    expect(page.items.some((item) => ["series.fixture.8", "series.fixture.10", "series.fixture.11"].includes(item.stableKey))).toBe(false);
    await expect(repository.recommendations("series.fixture.11", owner)).rejects.toMatchObject({ code: "MEDIA_NOT_AVAILABLE" });
    await db.update(schema.mediaVersions).set({ copyrightStatus: "cleared" }).where(eq(schema.mediaVersions.title, "Episode 10"));
    await db.update(schema.mediaAssets).set({ playbackExpiresAt: new Date("2099-01-01T00:00:00Z") }).where(eq(schema.mediaAssets.mediaVersionId, old.id));
    await db.update(schema.mediaItems).set({ currentVersion: 1 }).where(eq(schema.mediaItems.id, changed.id));
  });
  it("invalidates pagination when publication visibility changes and removes unavailable episodes from count/neighbors/recommendations", async () => {
    const first = await repository.listEpisodes("series.adventures", { pageSize: 3 }, owner);
    await db.update(schema.mediaVersions).set({ status: "archived" }).where(eq(schema.mediaVersions.title, "Episode 1"));
    await expect(repository.listEpisodes("series.adventures", { pageSize: 3, cursor: first.nextCursor! }, owner)).rejects.toMatchObject({ code: "MEDIA_SERIES_CURSOR_INVALID" });
    const current = await repository.listEpisodes("series.adventures", { pageSize: 3, anchorMediaKey: "series.fixture.0" }, owner);
    expect(current.series.episodeCount).toBe(11);
    expect(current.anchor.next?.stableKey).toBe("series.fixture.2");
    expect((await repository.recommendations("series.fixture.0", owner)).items.some((item) => item.stableKey === "series.fixture.1")).toBe(false);
    await expect(repository.recommendations("series.fixture.1", owner)).rejects.toMatchObject({ code: "MEDIA_NOT_AVAILABLE" });
  });
  it("requires both catalogue revisions for a move, audits both and preserves original media versions", async () => {
    await repository.save("series.destination", command({ idempotencyKey: "create-destination" }), owner);
    const move = command({ idempotencyKey: "move-to-destination", expectedRevision: 1, members: [member(2)] });
    await expect(repository.save("series.destination", move, owner)).rejects.toMatchObject({ code: "MEDIA_SERIES_MEMBERSHIP_CONFLICT" });
    await repository.save("series.destination", { ...move, fromSeriesRevisions: { "series.adventures": 1 } }, owner);
    expect((await repository.getSeries("series.adventures", owner)).revision).toBe(2);
    expect((await repository.getSeries("series.destination", owner)).episodeCount).toBe(1);
    expect((await db.select().from(schema.mediaVersions)).every((row) => row.version === 1)).toBe(true);
    expect(await db.select().from(schema.mediaSeriesChanges)).toHaveLength(4);
  });
  it("archives the series without revoking individual playback or exposing directory metadata", async () => {
    await repository.save("series.destination", command({ expectedRevision: 2, idempotencyKey: "archive-destination", status: "archived" }), owner);
    await expect(repository.getSeries("series.destination", owner)).rejects.toMatchObject({ code: "MEDIA_SERIES_NOT_AVAILABLE" });
    expect(await repository.recommendations("series.fixture.2", owner)).toEqual({ series: null, items: [] });
    const [item] = await db.select().from(schema.mediaItems).where(eq(schema.mediaItems.stableKey, "series.fixture.2"));
    expect(item.currentVersion).toBe(1);
  });
});
