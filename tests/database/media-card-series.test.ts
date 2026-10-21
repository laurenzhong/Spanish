// @vitest-environment node
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDrizzleMediaRepository } from "@/src/modules/media/repositories/drizzle-media-repository";
import { createDrizzleMediaSeriesRepository } from "@/src/modules/media/repositories/drizzle-media-series-repository";
import { mediaListQuerySchema } from "@/src/modules/media/schemas";
import type { SaveMediaSeriesCommand } from "@/src/modules/media/domain/media-series";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const owner = "00000000-0000-4000-8000-0000000000a1";
const other = "00000000-0000-4000-8000-0000000000a2";
const now = new Date("2026-10-16T00:00:00Z");
const listQuery = mediaListQuerySchema.parse({ sort: "recently_added" });
const browseQuery = { filters: {}, seed: "00000000-0000-4000-8000-000000000001", exclude: [], pageSize: 12 };
const previousOwners = process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
const command: SaveMediaSeriesCommand = { idempotencyKey: "card-series-initial", expectedRevision: 0, title: "Official programme", summary: "Fixture", kind: "video", orderMode: "ordered", status: "active", reason: "Official programme record", evidence: ["https://fixture.test/programme"],
  members: [0, 1].map((index) => ({ stableKey: `series.card.${index}`, position: index + 1, seasonNumber: index === 0 ? 1 : null, episodeNumber: index === 0 ? 2 : null, episodeLabel: index === 0 ? "S1 E2" : null, evidence: ["official-order"] })), removeStableKeys: [], fromSeriesRevisions: {} };

describe("fresh media card series summaries", () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleMediaRepository>;
  let directory: ReturnType<typeof createDrizzleMediaSeriesRepository>;
  const queries: string[] = [];
  beforeAll(async () => {
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = owner;
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
    for (const name of ["0000_big_phalanx", "0024_media_library_foundation", "0025_youtube_video_publication", "0026_brief_toro", "0027_pale_colossus", "0032_bunny_storage_video_expiry", "0033_bunny_storage_audio_expiry", "0034_media_word_timings", "0041_media_cefr_four_levels", "0046_media_series_directory"]) await client.exec((await readFile(`drizzle/${name}.sql`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    db = drizzle(client, { schema, logger: { logQuery: (query) => queries.push(query) } });
    await client.query("insert into auth.users (id) values ($1), ($2);", [owner, other]);
    await client.query("insert into profiles (id) values ($1), ($2);", [owner, other]);
    for (let index = 0; index < 3; index++) {
      const [item] = await db.insert(schema.mediaItems).values({ stableKey: `series.card.${index}`, kind: "video", currentVersion: 1 }).returning();
      const [version] = await db.insert(schema.mediaVersions).values({ mediaItemId: item.id, version: 1, title: `Video ${index}`, sourceName: "Original attribution", durationMs: 60_000, contentHash: "a".repeat(64), status: "published", copyrightStatus: "cleared", license: "licensed", attribution: "Fixture", licenseEvidence: "https://fixture.test/license" }).returning();
      await db.insert(schema.mediaAssets).values({ mediaVersionId: version.id, kind: "video", providerKey: "bunny-storage", playbackUrl: "https://fixture.b-cdn.net/media/video.mp4" });
      await db.insert(schema.userMediaProgress).values([{ userId: owner, mediaVersionId: version.id, lastPositionMs: 1000 }, { userId: other, mediaVersionId: version.id, lastPositionMs: 2000 }]);
    }
    repository = createDrizzleMediaRepository(db as unknown as Database, { now: () => now });
    directory = createDrizzleMediaSeriesRepository(db as unknown as Database, { now: () => now });
    await directory.save("series.official", command, owner);
  }, 30_000);
  afterAll(async () => {
    if (previousOwners === undefined) delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
    else process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = previousOwners;
    await client?.close();
  });
  const seriesReadQueries = () => queries.filter((query) => query.includes('from "media_series_memberships"'));

  it("uses one batched directory query for list and browse, and the same summary for lookup and playback", async () => {
    queries.length = 0;
    const list = await repository.list(listQuery, owner);
    expect(seriesReadQueries()).toHaveLength(1);
    expect(seriesReadQueries()[0]).toContain(" in (");
    queries.length = 0;
    const browse = await repository.browse(browseQuery, owner);
    expect(seriesReadQueries()).toHaveLength(1);
    const summary = { seriesKey: "series.official", title: "Official programme", kind: "video", orderMode: "ordered", revision: 1, seasonNumber: 1, episodeNumber: 2, episodeLabel: "S1 E2" };
    expect(list.items.find((card) => card.stableKey === "series.card.0")?.series).toEqual(summary);
    expect(browse.items.find((card) => card.stableKey === "series.card.0")?.series).toEqual(summary);
    expect((await repository.findByStableKey("series.card.0", owner)).media?.series).toEqual(summary);
    expect((await repository.getPlayback("series.card.0", owner, now)).media.series).toEqual(summary);
    expect(list.items.find((card) => card.stableKey === "series.card.1")?.series).toMatchObject({ seasonNumber: null, episodeNumber: null, episodeLabel: null });
    expect(list.items.find((card) => card.stableKey === "series.card.2")?.series).toBeNull();
    expect(list.items.every((card) => card.sourceName === "Original attribution")).toBe(true);
    expect(JSON.stringify(summary)).not.toMatch(/evidence|confirmedBy|actorUserId|signature/u);
  });

  it("refreshes a renamed directory while reusing cached catalogue rows and keeps each user's progress fresh", async () => {
    await directory.save("series.official", { ...command, members: [], expectedRevision: 1, idempotencyKey: "card-series-rename", title: "Renamed programme" }, owner);
    queries.length = 0;
    const list = await repository.list(listQuery, other);
    expect(queries.some((query) => query.includes('from "media_items"'))).toBe(false);
    expect(seriesReadQueries()).toHaveLength(1);
    expect(list.items.filter((card) => card.series).every((card) => card.series?.title === "Renamed programme" && card.series.revision === 2)).toBe(true);
    expect(list.items.every((card) => card.progress?.lastPositionMs === 2000)).toBe(true);
    expect((await repository.list(listQuery, owner)).items.every((card) => card.progress?.lastPositionMs === 1000)).toBe(true);
    expect((await repository.getPlayback("series.card.0", owner, now)).media.series?.title).toBe("Renamed programme");
  });

  it("hides archived directory summaries everywhere while retaining the original playable media versions", async () => {
    await directory.save("series.official", { ...command, members: [], expectedRevision: 2, idempotencyKey: "card-series-archive", status: "archived" }, owner);
    expect((await repository.list(listQuery, owner)).items.every((card) => card.series === null)).toBe(true);
    expect((await repository.browse(browseQuery, owner)).items.every((card) => card.series === null)).toBe(true);
    expect((await repository.findByStableKey("series.card.0", owner)).media?.series).toBeNull();
    expect((await repository.getPlayback("series.card.0", owner, now)).media).toMatchObject({ version: 1, series: null });
    expect((await db.select().from(schema.mediaItems)).every((item) => item.currentVersion === 1)).toBe(true);
    expect((await db.select().from(schema.mediaVersions)).every((version) => version.version === 1 && version.contentHash === "a".repeat(64))).toBe(true);
  });

  it("continues to reject media with withdrawn rights independently of the directory", async () => {
    await db.update(schema.mediaVersions).set({ copyrightStatus: "restricted" }).where(eq(schema.mediaVersions.title, "Video 0"));
    expect((await repository.browse(browseQuery, owner)).items.some((card) => card.stableKey === "series.card.0")).toBe(false);
    expect((await repository.findByStableKey("series.card.0", owner)).media).toBeNull();
    await expect(repository.getPlayback("series.card.0", owner, now)).rejects.toMatchObject({ code: "MEDIA_NOT_AVAILABLE" });
  });
});
