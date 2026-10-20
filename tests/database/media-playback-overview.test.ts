// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDrizzleMediaRepository, MediaUnavailableError } from "@/src/modules/media";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-0000000000c2";

const MIGRATIONS = [
  "0000_big_phalanx.sql",
  "0024_media_library_foundation.sql",
  "0025_youtube_video_publication.sql",
  "0026_brief_toro.sql",
  "0027_pale_colossus.sql",
  "0033_bunny_storage_audio_expiry.sql",
  "0034_media_word_timings.sql",
  "0041_media_cefr_four_levels.sql",
  "0046_media_series_directory.sql",
];

function versionValues(mediaItemId: string, version: number) {
  return {
    mediaItemId,
    version,
    title: `Overview fixture ${version}`,
    sourceName: "Fixture",
    durationMs: 60_000,
    curatedAt: new Date("2026-10-14"),
    status: "published" as const,
    copyrightStatus: "cleared" as const,
    region: "es-ES",
    cefr: "A2" as const,
    topics: [],
    contentHash: (version === 1 ? "a" : "b").repeat(64),
    license: "licensed" as const,
    attribution: "Fixture",
    licenseEvidence: "https://fixture.test/license",
  };
}

function segment(mediaVersionId: string, index: number, reviewStatus: "approved" | "pending" = "approved") {
  return {
    mediaVersionId,
    segmentIndex: index,
    startMs: index * 1_000,
    endMs: (index + 1) * 1_000,
    sourceText: `Frase ${index}.`,
    translation: `第 ${index} 句。`,
    speaker: null,
    reviewStatus,
    words: [{ text: `Frase`, startOffset: 0, endOffset: 5, startMs: index * 1_000, endMs: index * 1_000 + 500 }],
  };
}

describe("media playback overview", () => {
  let client: PGlite;
  let repository: ReturnType<typeof createDrizzleMediaRepository>;

  beforeAll(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
    for (const name of MIGRATIONS) {
      await client.exec((await readFile(`drizzle/${name}`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    const database = drizzle(client, { schema });

    // Available item: current version 2 with three approved cues and one pending.
    const [available] = await database.insert(schema.mediaItems).values({ stableKey: "media.overview.available", kind: "video", currentVersion: 2 }).returning();
    const versions = await database.insert(schema.mediaVersions).values([1, 2].map((version) => versionValues(available.id, version))).returning();
    const current = versions.find((version) => version.version === 2)!;
    const previous = versions.find((version) => version.version === 1)!;
    await database.insert(schema.mediaAssets).values([
      { mediaVersionId: current.id, kind: "video", providerKey: "bunny-storage", playbackUrl: "https://fixture.test/video.mp4", availability: "available" },
      { mediaVersionId: previous.id, kind: "video", providerKey: "bunny-storage", playbackUrl: "https://fixture.test/old.mp4", availability: "available" },
    ]);
    await database.insert(schema.mediaSegments).values([
      segment(current.id, 0),
      segment(current.id, 1),
      segment(current.id, 2, "pending"),
      segment(current.id, 3),
      segment(previous.id, 0),
    ]);

    // Withdrawn asset: must keep the same unavailable semantics as getPlayback.
    const [withdrawn] = await database.insert(schema.mediaItems).values({ stableKey: "media.overview.withdrawn", kind: "video", currentVersion: 1 }).returning();
    const [withdrawnVersion] = await database.insert(schema.mediaVersions).values(versionValues(withdrawn.id, 1)).returning();
    await database.insert(schema.mediaAssets).values({ mediaVersionId: withdrawnVersion.id, kind: "video", providerKey: "bunny-storage", playbackUrl: "https://fixture.test/withdrawn.mp4", availability: "withdrawn" });

    // Expired signed URL: same gate as the full playback.
    const [expired] = await database.insert(schema.mediaItems).values({ stableKey: "media.overview.expired", kind: "video", currentVersion: 1 }).returning();
    const [expiredVersion] = await database.insert(schema.mediaVersions).values(versionValues(expired.id, 1)).returning();
    await database.insert(schema.mediaAssets).values({ mediaVersionId: expiredVersion.id, kind: "video", providerKey: "bunny-storage", playbackUrl: "https://fixture.test/expired.mp4", availability: "available", playbackExpiresAt: new Date("2026-10-01") });

    repository = createDrizzleMediaRepository(database as unknown as Database);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("projects the current playable version and counts only its approved cues", async () => {
    const overview = await repository.getPlaybackOverview("media.overview.available", userId, new Date("2026-10-14"));
    expect(overview.media).toMatchObject({
      stableKey: "media.overview.available",
      version: 2,
      title: "Overview fixture 2",
      progress: null,
    });
    expect(overview.asset).toEqual({
      kind: "video",
      url: "https://fixture.test/video.mp4",
      expiresAt: null,
    });
    expect(overview.segmentCount).toBe(3);
  });

  it("serves the same sentences with and without word timings", async () => {
    const [full, textOnly] = await Promise.all([
      repository.getPlayback("media.overview.available", userId, new Date("2026-10-14")),
      repository.getPlayback("media.overview.available", userId, new Date("2026-10-14"), { includeWords: false }),
    ]);
    expect(textOnly.segments.map((segment) => segment.sourceText)).toEqual(full.segments.map((segment) => segment.sourceText));
    expect(full.segments.every((segment) => segment.words !== null)).toBe(true);
    expect(textOnly.segments).toHaveLength(3);
    expect(textOnly.segments.every((segment) => segment.words === null)).toBe(true);
    // The identity/version and asset are still exactly the full projection's.
    expect(textOnly.media).toEqual(full.media);
    expect(textOnly.asset).toEqual(full.asset);
  });

  it("keeps the publication, rights, availability and expiry gates", async () => {
    await expect(repository.getPlaybackOverview("media.overview.withdrawn", userId, new Date("2026-10-14"))).rejects.toBeInstanceOf(MediaUnavailableError);
    await expect(repository.getPlaybackOverview("media.overview.expired", userId, new Date("2026-10-14"))).rejects.toBeInstanceOf(MediaUnavailableError);
    await expect(repository.getPlaybackOverview("media.overview.missing", userId, new Date("2026-10-14"))).rejects.toBeInstanceOf(MediaUnavailableError);
  });

  it("does not keep serving text-only playback after the version is archived", async () => {
    const database = drizzle(client, { schema });
    const [item] = await database.select({ id: schema.mediaItems.id }).from(schema.mediaItems)
      .where(eq(schema.mediaItems.stableKey, "media.overview.available")).limit(1);
    await database.update(schema.mediaVersions)
      .set({ status: "archived" })
      .where(eq(schema.mediaVersions.mediaItemId, item!.id));
    await expect(repository.getPlayback("media.overview.available", userId, new Date("2026-10-14"), { includeWords: false })).rejects.toBeInstanceOf(MediaUnavailableError);
    await expect(repository.getPlaybackOverview("media.overview.available", userId, new Date("2026-10-14"))).rejects.toBeInstanceOf(MediaUnavailableError);
  });
});
