// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleMediaRepository,
  mediaListQuerySchema,
  MediaProgressConflictError,
  MediaUnavailableError,
} from "@/src/modules/media";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-0000000000e1";
const userB = "00000000-0000-4000-8000-0000000000e2";
const itemId = "10000000-0000-4000-8000-0000000000e1";
const versionId = "20000000-0000-4000-8000-0000000000e1";
const segmentId = "30000000-0000-4000-8000-0000000000e1";

async function migration(name: string) {
  return (await readFile(path.join(process.cwd(), "drizzle", name), "utf8"))
    .replaceAll("--> statement-breakpoint", "");
}

describe("media persistence", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleMediaRepository>;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
    await client.exec(await migration("0000_big_phalanx.sql"));
    await client.exec(await migration("0024_media_library_foundation.sql"));
    await client.exec(await migration("0025_youtube_video_publication.sql"));
    await client.exec(await migration("0026_brief_toro.sql"));
    await client.exec(await migration("0027_pale_colossus.sql"));
    await client.exec(await migration("0034_media_word_timings.sql"));
    database = drizzle(client, { schema });
    await client.exec("insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000e1', 'a@example.test'), ('00000000-0000-4000-8000-0000000000e2', 'b@example.test'); insert into profiles (id) values ('00000000-0000-4000-8000-0000000000e1'), ('00000000-0000-4000-8000-0000000000e2')");
    await database.insert(schema.mediaItems).values({ id: itemId, stableKey: "media.fixture.cafe", kind: "podcast", currentVersion: 1 });
    await database.insert(schema.mediaVersions).values({
      id: versionId,
      mediaItemId: itemId,
      version: 1,
      title: "Café de cada día",
      summary: "Charlas cortas.",
      sourceName: "Radio ejemplo",
      sourceUrl: "https://radio.example.test/episodes/1",
      region: "es-ES",
      cefr: "B1",
      topics: ["topic.daily-life"],
      durationMs: 600_000,
      publicationDate: new Date("2026-09-12T08:00:00.000Z"),
      curatedAt: new Date("2026-09-13T08:00:00.000Z"),
      publishedAt: new Date("2026-09-13T08:00:00.000Z"),
      contentHash: "a".repeat(64),
      status: "published",
      license: "licensed",
      attribution: "Radio ejemplo",
      licenseEvidence: "https://radio.example.test/license",
      copyrightStatus: "cleared",
    });
    await database.insert(schema.mediaAssets).values({
      mediaVersionId: versionId,
      kind: "audio",
      providerKey: "podcast-rss",
      playbackUrl: "https://radio.example.test/episodes/1.mp3",
      playbackExpiresAt: new Date("2036-09-13T10:00:00.000Z"),
    });
    await database.insert(schema.mediaSegments).values([
      { id: segmentId, mediaVersionId: versionId, segmentIndex: 0, startMs: 0, endMs: 2_000, sourceText: "Buenos días.", translation: "早上好。", reviewStatus: "approved" },
      { mediaVersionId: versionId, segmentIndex: 1, startMs: 2_000, endMs: 4_000, sourceText: "Borrador", reviewStatus: "pending" },
    ]);
    repository = createDrizzleMediaRepository(database as unknown as Database, {
      now: () => new Date("2026-09-13T10:00:00.000Z"),
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it("lists current playable versions and returns only approved playback segments", async () => {
    const page = await repository.list(mediaListQuerySchema.parse({}), userA);
    expect(page).toMatchObject({ items: [{ stableKey: "media.fixture.cafe", kind: "podcast", progress: null }], hasMore: false });
    await expect(repository.getPlayback("media.fixture.cafe", userA, new Date("2026-09-13T10:00:00.000Z"))).resolves.toMatchObject({
      asset: { kind: "audio", url: "https://radio.example.test/episodes/1.mp3" },
      segments: [{ id: segmentId }],
    });
  });

  it("allows permanent Bunny hosted video without exempting ordinary RSS audio", async () => {
    await client.exec(await migration("0030_glossy_norrin_radd.sql"));
    await client.exec(await migration("0031_media_transcript_backfills.sql"));
    await client.exec(await migration("0032_bunny_storage_video_expiry.sql"));
    await database.update(schema.mediaAssets).set({
      kind: "video", providerKey: "bunny-storage",
      playbackUrl: "https://media.example.test/video.mp4", playbackExpiresAt: null,
    });
    await expect(repository.getPlayback("media.fixture.cafe", userA, new Date("2036-09-13T10:00:00.000Z"))).resolves.toMatchObject({
      asset: { url: "https://media.example.test/video.mp4", expiresAt: null },
    });
    await expect(client.exec("update media_assets set kind = 'audio', provider_key = 'podcast-rss', playback_expires_at = null")).rejects.toThrow(/media_assets_expiry_policy_check/);
    await expect(client.exec("update media_assets set kind = 'audio', provider_key = 'bunny-storage', playback_expires_at = null")).rejects.toThrow(/media_assets_expiry_policy_check/);
  });

  it("saves isolated progress with idempotent replay and revision conflicts", async () => {
    const first = await repository.saveProgress(userA, "media.fixture.cafe", 1, {
      expectedRevision: 0, lastPositionMs: 2_000, lastSegmentIndex: 0, status: "in_progress",
    }, new Date("2026-09-13T10:00:00.000Z"));
    expect(first.revision).toBe(1);
    await expect(repository.saveProgress(userA, "media.fixture.cafe", 1, {
      expectedRevision: 0, lastPositionMs: 2_000, lastSegmentIndex: 0, status: "in_progress",
    }, new Date("2026-09-13T10:01:00.000Z"))).resolves.toEqual(first);
    await expect(repository.saveProgress(userA, "media.fixture.cafe", 1, {
      expectedRevision: 0, lastPositionMs: 3_000, lastSegmentIndex: 0, status: "in_progress",
    }, new Date("2026-09-13T10:02:00.000Z"))).rejects.toBeInstanceOf(MediaProgressConflictError);
    await expect(repository.findByStableKey("media.fixture.cafe", userB)).resolves.toMatchObject({ media: { progress: null } });
  });

  it("extends the lease exemption to hosted Bunny audio without changing RSS policy", async () => {
    await client.exec(await migration("0030_glossy_norrin_radd.sql"));
    await client.exec(await migration("0032_bunny_storage_video_expiry.sql"));
    await expect(client.exec("update media_assets set kind='audio', provider_key='bunny-storage', playback_expires_at=null")).rejects.toThrow(/media_assets_expiry_policy_check/);
    await client.exec(await migration("0033_bunny_storage_audio_expiry.sql"));
    await client.exec("update media_assets set kind='audio', provider_key='bunny-storage', playback_expires_at=null");
    await expect(repository.getPlayback("media.fixture.cafe", userA, new Date("2036-09-13T10:00:00.000Z"))).resolves.toMatchObject({ asset: { kind: "audio", expiresAt: null } });
    await expect(client.exec("update media_assets set provider_key='podcast-rss'")).rejects.toThrow(/media_assets_expiry_policy_check/);
  });

  it("sorts recently continued content by the persisted last-opened time", async () => {
    await client.exec(await migration("0030_glossy_norrin_radd.sql"));
    await client.exec(await migration("0032_bunny_storage_video_expiry.sql"));
    await client.exec(await migration("0035_bunny_video_asset_guard.sql"));
    const secondItemId = "10000000-0000-4000-8000-0000000000e2";
    const secondVersionId = "20000000-0000-4000-8000-0000000000e2";
    await database.insert(schema.mediaItems).values({ id: secondItemId, stableKey: "media.fixture.news", kind: "video", currentVersion: 1 });
    await database.insert(schema.mediaVersions).values({
      id: secondVersionId, mediaItemId: secondItemId, version: 1, title: "Noticias", summary: "Resumen",
      sourceName: "Canal ejemplo", sourceUrl: "https://video.example.test/1", region: "es-MX", cefr: "A2",
      topics: ["topic.news"], durationMs: 300_000, curatedAt: new Date("2026-09-13T09:00:00.000Z"),
      contentHash: "b".repeat(64), status: "published", license: "licensed", attribution: "Canal ejemplo",
      licenseEvidence: "https://video.example.test/license", copyrightStatus: "cleared",
    });
    await database.insert(schema.mediaAssets).values({ mediaVersionId: secondVersionId, kind: "video", providerKey: "bunny-storage", playbackUrl: "https://media.example.test/video-2.mp4", mimeType: "video/mp4" });
    await repository.saveProgress(userA, "media.fixture.cafe", 1, { expectedRevision: 0, lastPositionMs: 2_000, lastSegmentIndex: 0, status: "in_progress" }, new Date("2026-09-13T10:00:00.000Z"));
    await repository.saveProgress(userA, "media.fixture.news", 1, { expectedRevision: 0, lastPositionMs: 1_000, lastSegmentIndex: null, status: "in_progress" }, new Date("2026-09-13T11:00:00.000Z"));

    const page = await repository.list(mediaListQuerySchema.parse({ sort: "recently_played" }), userA);
    expect(page.items.map((item) => item.stableKey)).toEqual(["media.fixture.news", "media.fixture.cafe"]);
  });

  it("removes withdrawn assets from public projections without deleting history", async () => {
    await database.update(schema.mediaAssets).set({ availability: "withdrawn" });
    await expect(repository.list(mediaListQuerySchema.parse({}))).resolves.toMatchObject({ items: [] });
    await expect(repository.getPlayback("media.fixture.cafe", userA, new Date("2026-09-13T10:00:00.000Z"))).rejects.toBeInstanceOf(MediaUnavailableError);
    await expect(repository.saveProgress(userA, "media.fixture.cafe", 1, {
      expectedRevision: 0, lastPositionMs: 2_000, lastSegmentIndex: 0, status: "in_progress",
    }, new Date("2026-09-13T10:00:00.000Z"))).rejects.toBeInstanceOf(MediaUnavailableError);
  });
});
