// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDrizzleMediaRepository, MediaUnavailableError } from "@/src/modules/media";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

describe("media stream source reads", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleMediaRepository>;
  const queries: string[] = [];
  const now = new Date("2026-10-14T00:00:00Z");

  beforeAll(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
    for (const name of ["0000_big_phalanx.sql", "0024_media_library_foundation.sql", "0025_youtube_video_publication.sql", "0026_brief_toro.sql", "0027_pale_colossus.sql", "0033_bunny_storage_audio_expiry.sql", "0034_media_word_timings.sql", "0041_media_cefr_four_levels.sql"]) {
      await client.exec((await readFile(`drizzle/${name}`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    database = drizzle(client, { schema, logger: { logQuery: (query) => queries.push(query) } });
    for (const kind of ["video", "podcast"] as const) {
      const [item] = await database.insert(schema.mediaItems).values({ stableKey: `media.stream.${kind}`, kind, currentVersion: 2 }).returning();
      const versions = await database.insert(schema.mediaVersions).values([1, 2].map((version) => ({
        mediaItemId: item.id, version, title: `Stream ${kind}`, sourceName: "Fixture", durationMs: 900_000,
        curatedAt: now, status: "published" as const, copyrightStatus: "cleared" as const,
        region: "es-ES", cefr: "A2" as const, topics: [], contentHash: "a".repeat(64),
        license: "licensed" as const, attribution: "Fixture", licenseEvidence: "https://fixture.test/license",
      }))).returning();
      await database.insert(schema.mediaAssets).values(versions.map((version) => ({
        mediaVersionId: version.id, kind: kind === "video" ? "video" as const : "audio" as const,
        providerKey: "bunny-storage", playbackUrl: `https://fixture.test/${kind}-v${version.version}`,
        availability: "available" as const,
      })));
    }
    repository = createDrizzleMediaRepository(database as unknown as Database);
  }, 30_000);
  afterAll(async () => { await client?.close(); });

  it.each(["video", "podcast"])("reads the current %s source with one query and no transcript or progress", async (kind) => {
    queries.length = 0;
    const source = await repository.getStreamSource(`media.stream.${kind}`, now);
    expect(source).toEqual({
      media: { stableKey: `media.stream.${kind}`, version: 2, kind, title: `Stream ${kind}`, sourceName: "Fixture" },
      asset: { kind: kind === "video" ? "video" : "audio", url: `https://fixture.test/${kind}-v2`, expiresAt: null },
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toMatch(/media_segments|user_media_progress/u);
  });

  it("rechecks withdrawal on every range instead of reusing a cached source", async () => {
    await repository.getStreamSource("media.stream.video", now);
    await database.update(schema.mediaAssets).set({ availability: "withdrawn" }).where(eq(schema.mediaAssets.playbackUrl, "https://fixture.test/video-v2"));
    await expect(repository.getStreamSource("media.stream.video", now)).rejects.toBeInstanceOf(MediaUnavailableError);
  });

  it("rejects expired sources, unapproved rights, archived versions and unknown keys", async () => {
    await database.update(schema.mediaAssets).set({ playbackExpiresAt: now }).where(eq(schema.mediaAssets.playbackUrl, "https://fixture.test/podcast-v2"));
    await expect(repository.getStreamSource("media.stream.podcast", now)).rejects.toBeInstanceOf(MediaUnavailableError);
    await database.update(schema.mediaAssets).set({ playbackExpiresAt: null }).where(eq(schema.mediaAssets.playbackUrl, "https://fixture.test/podcast-v2"));
    await database.update(schema.mediaVersions).set({ copyrightStatus: "restricted" }).where(eq(schema.mediaVersions.version, 2));
    await expect(repository.getStreamSource("media.stream.podcast", now)).rejects.toBeInstanceOf(MediaUnavailableError);
    await database.update(schema.mediaVersions).set({ copyrightStatus: "cleared", status: "archived" }).where(eq(schema.mediaVersions.version, 2));
    await expect(repository.getStreamSource("media.stream.podcast", now)).rejects.toBeInstanceOf(MediaUnavailableError);
    await expect(repository.getStreamSource("media.stream.unknown", now)).rejects.toBeInstanceOf(MediaUnavailableError);
  });
});
