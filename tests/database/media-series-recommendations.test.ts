// @vitest-environment node
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDrizzleMediaSeriesRepository } from "@/src/modules/media/repositories/drizzle-media-series-repository";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-0000000000a1";
const userB = "00000000-0000-4000-8000-0000000000a2";
const now = new Date("2026-10-16T00:00:00Z");

describe("series recommendation SQL edge cases", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleMediaSeriesRepository>;
  const queries: string[] = [];

  beforeAll(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
    for (const name of ["0000_big_phalanx", "0024_media_library_foundation", "0025_youtube_video_publication", "0026_brief_toro", "0027_pale_colossus", "0032_bunny_storage_video_expiry", "0033_bunny_storage_audio_expiry", "0041_media_cefr_four_levels", "0046_media_series_directory"]) await client.exec((await readFile(`drizzle/${name}.sql`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    db = drizzle(client, { schema, logger: { logQuery: (query) => queries.push(query) } });
    await client.query("insert into auth.users (id) values ($1), ($2)", [userA, userB]);
    await client.query("insert into profiles (id) values ($1), ($2)", [userA, userB]);
    repository = createDrizzleMediaSeriesRepository(db as unknown as Database, { now: () => now });
  }, 30_000);
  afterAll(async () => { await client?.close(); });

  async function createSeries(key: string, episodes: readonly Readonly<{ slug: string; publishedAt?: string | null }>[], orderMode: "ordered" | "episodic" = "ordered", kind: "video" | "podcast" = "video") {
    const [series] = await db.insert(schema.mediaSeries).values({ seriesKey: key, title: key, kind, orderMode }).returning();
    const result: { key: string; item: typeof schema.mediaItems.$inferSelect; version: typeof schema.mediaVersions.$inferSelect }[] = [];
    for (const [index, episode] of episodes.entries()) {
      const stableKey = `${key}.${episode.slug}`;
      const [item] = await db.insert(schema.mediaItems).values({ stableKey, kind, currentVersion: 1 }).returning();
      const [version] = await db.insert(schema.mediaVersions).values({ mediaItemId: item.id, version: 1, title: stableKey, sourceName: "Fixture source", durationMs: 60_000, contentHash: "a".repeat(64), status: "published", copyrightStatus: "cleared", license: "licensed", attribution: "Fixture", licenseEvidence: "https://fixture.test/license", publicationDate: episode.publishedAt ? new Date(episode.publishedAt) : null }).returning();
      await db.insert(schema.mediaAssets).values({ mediaVersionId: version.id, kind: kind === "video" ? "video" : "audio", providerKey: "bunny-storage", playbackUrl: "https://fixture.b-cdn.net/media/file.mp4" });
      await db.insert(schema.mediaSeriesMemberships).values({ mediaItemId: item.id, seriesId: series.id, position: orderMode === "ordered" ? (index + 1) * 10 : null, seasonNumber: null, episodeNumber: null, episodeLabel: null, evidence: ["https://fixture.test/programme"], confirmedBy: userA });
      await db.insert(schema.userMediaProgress).values([{ userId: userA, mediaVersionId: version.id, lastPositionMs: 1000, status: index % 2 ? "completed" : "in_progress" }, { userId: userB, mediaVersionId: version.id, lastPositionMs: 2000, status: "in_progress" }]);
      result.push({ key: stableKey, item, version });
    }
    return { series, episodes: result };
  }

  it.each([2, 7, 9])("bounds recommendations for %i visible episodes without inventing official episode labels", async (count) => {
    const fixture = await createSeries(`recommend.bound.${count}`, Array.from({ length: count }, (_, index) => ({ slug: `episode-${index}` })));
    const result = await repository.recommendations(fixture.episodes[0].key, userA);
    expect(result.items.map((item) => item.stableKey)).toEqual(fixture.episodes.slice(1, 7).map((item) => item.key));
    expect(result.items).toHaveLength(Math.min(count - 1, 6));
    expect(result.items.every((item) => item.series?.seasonNumber === null && item.series.episodeNumber === null && item.series.episodeLabel === null)).toBe(true);
    expect(result.series?.episodeCount).toBe(count);
  });

  it("fills a final episode's cards from the earliest visible predecessors", async () => {
    const fixture = await createSeries("recommend.final", Array.from({ length: 8 }, (_, index) => ({ slug: `episode-${index}` })));
    const result = await repository.recommendations(fixture.episodes.at(-1)!.key, userA);
    expect(result.items.map((item) => item.stableKey)).toEqual(fixture.episodes.slice(0, 6).map((item) => item.key));
  });

  it("sorts episodic video SQL by timestamp, stable ties and missing dates last", async () => {
    const fixture = await createSeries("recommend.episodic", [
      { slug: "current" }, { slug: "new-b", publishedAt: "2026-10-15T00:00:00Z" },
      { slug: "new-a", publishedAt: "2026-10-15T01:00:00+01:00" }, { slug: "old", publishedAt: "2026-01-01T00:00:00Z" },
      { slug: "unknown-b" }, { slug: "unknown-a" },
    ], "episodic");
    const result = await repository.recommendations(fixture.episodes[0].key, userA);
    expect(result.items.map((item) => item.stableKey.split(".").at(-1))).toEqual(["new-a", "new-b", "old", "unknown-a", "unknown-b"]);
  });

  it("returns an empty result for a one-episode series and for a populated podcast series", async () => {
    const single = await createSeries("recommend.single", [{ slug: "only" }]);
    expect(await repository.recommendations(single.episodes[0].key, userA)).toMatchObject({ series: { episodeCount: 1 }, items: [] });
    const podcast = await createSeries("recommend.podcast", [{ slug: "one" }, { slug: "two" }], "episodic", "podcast");
    expect(await repository.recommendations(podcast.episodes[0].key, userA)).toEqual({ series: null, items: [] });
  });

  it("uses the current playable version and filters draft, rights, expiry, missing and withdrawn assets from cards and count", async () => {
    const fixture = await createSeries("recommend.gates", Array.from({ length: 9 }, (_, index) => ({ slug: `episode-${index}` })));
    await createSeries("recommend.other", [{ slug: "one" }, { slug: "two" }]);
    const version2 = { ...fixture.episodes[1].version, id: undefined, version: 2, title: "Current replacement", contentHash: "b".repeat(64) };
    const [current] = await db.insert(schema.mediaVersions).values(version2).returning();
    await db.insert(schema.mediaAssets).values({ mediaVersionId: current.id, kind: "video", providerKey: "bunny-storage", playbackUrl: "https://fixture.b-cdn.net/media/current.mp4" });
    await db.update(schema.mediaItems).set({ currentVersion: 2 }).where(eq(schema.mediaItems.id, fixture.episodes[1].item.id));
    await db.update(schema.mediaVersions).set({ status: "draft" }).where(eq(schema.mediaVersions.id, fixture.episodes[2].version.id));
    await db.update(schema.mediaVersions).set({ copyrightStatus: "restricted" }).where(eq(schema.mediaVersions.id, fixture.episodes[3].version.id));
    await db.update(schema.mediaAssets).set({ availability: "withdrawn" }).where(eq(schema.mediaAssets.mediaVersionId, fixture.episodes[4].version.id));
    await db.update(schema.mediaAssets).set({ playbackExpiresAt: new Date("2026-10-15T23:59:59Z") }).where(eq(schema.mediaAssets.mediaVersionId, fixture.episodes[5].version.id));
    await db.update(schema.mediaItems).set({ currentVersion: 2 }).where(eq(schema.mediaItems.id, fixture.episodes[6].item.id));
    await db.delete(schema.mediaAssets).where(eq(schema.mediaAssets.mediaVersionId, fixture.episodes[7].version.id));
    await db.update(schema.mediaAssets).set({ availability: "unavailable" }).where(eq(schema.mediaAssets.mediaVersionId, fixture.episodes[8].version.id));
    const result = await repository.recommendations(fixture.episodes[0].key, userA);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ stableKey: fixture.episodes[1].key, version: 2, title: "Current replacement", contentHash: "b".repeat(64) });
    expect(result.series?.episodeCount).toBe(2);
    expect((await repository.getSeries(fixture.series.seriesKey, userA)).episodeCount).toBe(2);
    expect((await repository.listEpisodes(fixture.series.seriesKey, { pageSize: 50 }, userA)).items.map((item) => item.stableKey)).toEqual([fixture.episodes[0].key, fixture.episodes[1].key]);
  });

  it("reads a single narrow statement, isolates progress and does not personalize order or write learning evidence", async () => {
    const fixture = await createSeries("recommend.privacy", [{ slug: "current" }, { slug: "next" }, { slug: "last" }]);
    const beforeProgress = await db.select().from(schema.userMediaProgress);
    const beforeEvidence = await db.select().from(schema.evidenceEvents);
    queries.length = 0;
    const first = await repository.recommendations(fixture.episodes[0].key, userA);
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain("media_segments");
    const second = await repository.recommendations(fixture.episodes[0].key, userB);
    expect(first.items.map((item) => item.stableKey)).toEqual(second.items.map((item) => item.stableKey));
    expect(first.items.every((item) => item.progress?.lastPositionMs === 1000)).toBe(true);
    expect(second.items.every((item) => item.progress?.lastPositionMs === 2000)).toBe(true);
    expect(first.items.some((item) => item.progress?.status === "completed")).toBe(true);
    expect(await db.select().from(schema.userMediaProgress)).toEqual(beforeProgress);
    expect(await db.select().from(schema.evidenceEvents)).toEqual(beforeEvidence);
  });
});
