// @vitest-environment node
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDrizzleMediaRepository } from "@/src/modules/media/repositories/drizzle-media-repository";
import type { MediaBrowseQuery } from "@/src/modules/media/schemas";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-0000000000a1";
const userB = "00000000-0000-4000-8000-0000000000a2";
const channelA = `UC${"a".repeat(22)}`;
const channelB = `UC${"b".repeat(22)}`;
const now = new Date("2026-10-16T00:00:00Z");

describe("stable source and series browse SQL integration", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleMediaRepository>;
  beforeAll(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
    for (const name of ["0000_big_phalanx", "0024_media_library_foundation", "0025_youtube_video_publication", "0026_brief_toro", "0027_pale_colossus", "0032_bunny_storage_video_expiry", "0033_bunny_storage_audio_expiry", "0041_media_cefr_four_levels", "0046_media_series_directory"]) await client.exec((await readFile(`drizzle/${name}.sql`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    db = drizzle(client, { schema });
    await client.query("insert into auth.users (id) values ($1), ($2)", [userA, userB]);
    await client.query("insert into profiles (id) values ($1), ($2)", [userA, userB]);
    repository = createDrizzleMediaRepository(db as unknown as Database, { now: () => now });
  }, 30_000);
  afterAll(async () => { await client?.close(); });

  async function seed(prefix: string, kind: "video" | "podcast", inputs: readonly { slug: string; channel?: string; feed?: string; name?: string }[]) {
    const rows: { key: string; itemId: string; versionId: string }[] = [];
    for (const input of inputs) {
      const stableKey = `${prefix}.${input.slug}`;
      const [item] = await db.insert(schema.mediaItems).values({ stableKey, kind, currentVersion: 1 }).returning();
      const [version] = await db.insert(schema.mediaVersions).values({ mediaItemId: item.id, version: 1, title: stableKey, sourceName: input.name ?? "Same display name", sourceChannelId: input.channel ?? null, sourceFeedUrl: input.feed ?? null, durationMs: 60_000, contentHash: "a".repeat(64), status: "published", copyrightStatus: "cleared", license: "licensed", attribution: "Fixture", licenseEvidence: "https://fixture.test/license" }).returning();
      await db.insert(schema.mediaAssets).values({ mediaVersionId: version.id, kind: kind === "video" ? "video" : "audio", providerKey: "bunny-storage", playbackUrl: "https://fixture.b-cdn.net/media/file.mp4" });
      await db.insert(schema.userMediaProgress).values([{ userId: userA, mediaVersionId: version.id, lastPositionMs: 1000 }, { userId: userB, mediaVersionId: version.id, lastPositionMs: 2000 }]);
      rows.push({ key: stableKey, itemId: item.id, versionId: version.id });
    }
    return rows;
  }
  async function series(key: string, rows: readonly { itemId: string }[], kind: "video" | "podcast" = "video") {
    const [created] = await db.insert(schema.mediaSeries).values({ seriesKey: key, title: key, kind, orderMode: "episodic" }).returning();
    await db.insert(schema.mediaSeriesMemberships).values(rows.map((row) => ({ mediaItemId: row.itemId, seriesId: created.id, evidence: ["https://fixture.test/programme"], confirmedBy: userA })));
    return created;
  }
  const query = (prefix: string, pageSize = 2, seedIndex = 1): MediaBrowseQuery => ({ filters: { search: prefix }, seed: `00000000-0000-4000-8000-${String(seedIndex).padStart(12, "0")}`, exclude: [], pageSize });
  async function allPages(input: MediaBrowseQuery, user = userA) {
    const cards = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const result = await repository.browse({ ...input, cursor }, user);
      cards.push(...result.items);
      if (!result.hasMore) return cards;
      expect(result.nextCursor).toBeTruthy();
      cursor = result.nextCursor!;
    }
    throw new Error("Browse did not exhaust its finite fixture");
  }

  it("separates identically named video channels and ignores display name changes when resuming", async () => {
    const prefix = "browse.stable-channel";
    const rows = await seed(prefix, "video", [...Array.from({ length: 6 }, (_, index) => ({ slug: `a-${index}`, channel: channelA })), ...Array.from({ length: 3 }, (_, index) => ({ slug: `b-${index}`, channel: channelB }))]);
    for (let index = 1; index <= 8; index++) {
      const result = await repository.browse(query(prefix, 2, index), userA);
      expect(new Set(result.items.map((card) => card.stableKey.split(".").at(-1)![0])).size).toBe(2);
    }
    const before = await repository.browse(query(prefix), userA);
    const beforeOrder = (await allPages(query(prefix))).map((card) => card.stableKey);
    await db.update(schema.mediaVersions).set({ sourceName: "Renamed visible channel" }).where(eq(schema.mediaVersions.id, rows[0].versionId));
    const after = await repository.browse(query(prefix), userA);
    expect(after.items.map((card) => card.stableKey)).toEqual(before.items.map((card) => card.stableKey));
    expect(after.nextCursor).toBe(before.nextCursor);
    expect((await allPages(query(prefix))).map((card) => card.stableKey)).toEqual(beforeOrder);
    await expect(repository.browse({ ...query(prefix), cursor: before.nextCursor! }, userA)).resolves.toHaveProperty("items");
  });

  it("cycles series within one source, fills every page, isolates progress and invalidates revision changes", async () => {
    const prefix = "browse.series-fill";
    const rows = await seed(prefix, "video", Array.from({ length: 7 }, (_, index) => ({ slug: `item-${index}`, channel: channelA })));
    const firstSeries = await series("browse.series-fill.first", rows.slice(0, 3));
    await series("browse.series-fill.second", rows.slice(3, 5));
    const first = await repository.browse(query(prefix, 4), userA);
    expect(new Set(first.items.map((card) => card.series?.seriesKey ?? card.stableKey)).size).toBe(4);
    const all = await allPages(query(prefix, 3));
    expect(all).toHaveLength(7);
    expect(new Set(all.map((card) => card.stableKey)).size).toBe(7);
    expect(all.every((card) => card.progress?.lastPositionMs === 1000)).toBe(true);
    const other = await allPages(query(prefix, 3), userB);
    expect(other.map((card) => card.stableKey)).toEqual(all.map((card) => card.stableKey));
    expect(other.every((card) => card.progress?.lastPositionMs === 2000)).toBe(true);
    const excluded = await allPages({ ...query(prefix, 3), exclude: first.items.slice(0, 2).map((card) => card.stableKey) });
    expect(excluded).toHaveLength(5);
    const page = await repository.browse(query(prefix, 3), userA);
    await db.update(schema.mediaSeries).set({ revision: 2 }).where(eq(schema.mediaSeries.id, firstSeries.id));
    await expect(repository.browse({ ...query(prefix, 3), cursor: page.nextCursor! }, userA)).rejects.toThrow("MEDIA_CURSOR_INVALID");
    expect((await allPages(query(prefix, 3))).map((card) => card.stableKey)).toEqual(all.map((card) => card.stableKey));
    const stableOrderPage = await repository.browse(query(prefix, 3), userA);
    await db.update(schema.mediaVersions).set({ sourceChannelId: channelB }).where(inArray(schema.mediaVersions.id, rows.map((row) => row.versionId)));
    await expect(repository.browse({ ...query(prefix, 3), cursor: stableOrderPage.nextCursor! }, userA)).rejects.toThrow("MEDIA_CURSOR_INVALID");
    expect((await allPages(query(prefix, 3))).map((card) => card.stableKey)).toEqual(all.map((card) => card.stableKey));
    const excludedSeriesQuery = { ...query(prefix, 2), exclude: rows.slice(0, 3).map((row) => row.key) };
    const excludedSeriesPage = await repository.browse(excludedSeriesQuery, userA);
    await db.update(schema.mediaSeries).set({ revision: 3 }).where(eq(schema.mediaSeries.id, firstSeries.id));
    await expect(repository.browse({ ...excludedSeriesQuery, cursor: excludedSeriesPage.nextCursor! }, userA)).rejects.toThrow("MEDIA_CURSOR_INVALID");
  });

  it("normalizes genuine RSS identity while keeping different feeds with the same display name separate", async () => {
    const prefix = "browse.real-feeds";
    await seed(prefix, "podcast", [
      { slug: "a-0", feed: "https://RSS.FIXTURE.test:443/a.xml?b=2&a=1#first" },
      { slug: "a-1", feed: "https://rss.fixture.test/a.xml?a=1&b=2#second" },
      { slug: "a-2", feed: "https://rss.fixture.test/a.xml?b=2&a=1" },
      { slug: "b-0", feed: "https://rss.fixture.test/b.xml" }, { slug: "b-1", feed: "https://rss.fixture.test/b.xml" },
    ]);
    for (let index = 1; index <= 8; index++) {
      const result = await repository.browse(query(prefix, 2, index), userA);
      expect(new Set(result.items.map((card) => card.stableKey.split(".").at(-1)![0])).size).toBe(2);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/sourceIdentity|sourceFeedUrl|rss\.fixture|podcast-feed:/u);
    }
  });

  it("uses the registered LR aggregate source without inventing per-show RSS identities", async () => {
    const prefix = "browse.lr-aggregate";
    const rows = await seed(prefix, "podcast", [
      ...Array.from({ length: 4 }, (_, index) => ({ slug: `lr-${index}`, feed: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es", name: `Programme display ${index}` })),
      ...Array.from({ length: 2 }, (_, index) => ({ slug: `rss-${index}`, feed: "https://real.fixture.test/programme.xml", name: "Programme display 0" })),
    ]);
    await series("browse.lr-aggregate.first", rows.slice(0, 2), "podcast");
    await series("browse.lr-aggregate.second", rows.slice(2, 4), "podcast");
    for (let index = 1; index <= 8; index++) {
      const result = await repository.browse(query(prefix, 2, index), userA);
      expect(new Set(result.items.map((card) => card.stableKey.split(".").at(-1)!.split("-")[0])).size).toBe(2);
    }
    expect(await allPages(query(prefix))).toHaveLength(6);
  });

  it("keeps missing, malformed and credential-bearing source metadata as independent stable media fallbacks", async () => {
    const prefix = "browse.fallback";
    await seed(prefix, "video", [{ slug: "first", channel: "not-a-trusted-channel" }, { slug: "second" }, { slug: "third" }]);
    const result = await allPages(query(prefix));
    expect(result).toHaveLength(3);
    expect(new Set(result.map((card) => card.stableKey)).size).toBe(3);
    const podcast = "browse.credential-feed";
    await seed(podcast, "podcast", [{ slug: "first", feed: "https://rss.fixture.test/feed.xml?token=private-one" }, { slug: "second", feed: "https://rss.fixture.test/feed.xml?token=private-two" }]);
    const cards = await allPages(query(podcast));
    expect(cards).toHaveLength(2);
    expect(JSON.stringify(cards)).not.toMatch(/private-one|private-two|sourceIdentity|sourceFeedUrl/u);
  });

  it("preserves current publication and asset gates during source/series pagination", async () => {
    const prefix = "browse.gates";
    const rows = await seed(prefix, "video", Array.from({ length: 5 }, (_, index) => ({ slug: `item-${index}`, channel: channelA })));
    await series("browse.gates.series", rows);
    const first = await repository.browse(query(prefix), userA);
    await db.update(schema.mediaVersions).set({ copyrightStatus: "restricted" }).where(eq(schema.mediaVersions.id, rows[1].versionId));
    await db.update(schema.mediaVersions).set({ status: "draft" }).where(eq(schema.mediaVersions.id, rows[2].versionId));
    await db.update(schema.mediaAssets).set({ availability: "withdrawn" }).where(eq(schema.mediaAssets.mediaVersionId, rows[3].versionId));
    await db.update(schema.mediaItems).set({ currentVersion: 2 }).where(eq(schema.mediaItems.id, rows[4].itemId));
    await expect(repository.browse({ ...query(prefix), cursor: first.nextCursor! }, userA)).rejects.toThrow("MEDIA_CURSOR_INVALID");
    expect((await allPages(query(prefix))).map((card) => card.stableKey)).toEqual([rows[0].key]);
  });
});
