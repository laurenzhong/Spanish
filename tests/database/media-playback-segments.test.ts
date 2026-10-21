// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzleMediaRepository } from "@/src/modules/media";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const userId = "00000000-0000-4000-8000-0000000000c1";
const stableKey = "media.fixture.complete-transcript";

describe("complete approved playback transcript persistence", () => {
  let client: PGlite;
  let repository: ReturnType<typeof createDrizzleMediaRepository>;
  beforeAll(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
    for (const name of ["0000_big_phalanx.sql", "0024_media_library_foundation.sql", "0025_youtube_video_publication.sql", "0026_brief_toro.sql", "0027_pale_colossus.sql", "0033_bunny_storage_audio_expiry.sql", "0034_media_word_timings.sql", "0041_media_cefr_four_levels.sql", "0046_media_series_directory.sql"]) {
      await client.exec((await readFile(`drizzle/${name}`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    const database = drizzle(client, { schema });
    const [item] = await database.insert(schema.mediaItems).values({ stableKey, kind: "video", currentVersion: 2 }).returning();
    const versions = await database.insert(schema.mediaVersions).values([1, 2].map((version) => ({
      mediaItemId: item.id, version, title: "Long reviewed video", sourceName: "Fixture",
      durationMs: 900_000, curatedAt: new Date("2026-10-14"),
      status: "published" as const, copyrightStatus: "cleared" as const,
      region: "es-ES", cefr: "A2" as const, topics: [], contentHash: "a".repeat(64),
      license: "licensed" as const, attribution: "Fixture", licenseEvidence: "https://fixture.test/license",
    }))).returning();
    const current = versions.find((version) => version.version === 2)!;
    await database.insert(schema.mediaAssets).values({ mediaVersionId: current.id, kind: "video", providerKey: "bunny-storage", playbackUrl: "https://fixture.test/video.mp4", availability: "available" });
    await database.insert(schema.mediaSegments).values([
      // Insert backwards to ensure the repository orders by the original index.
      ...Array.from({ length: 849 }, (_, offset) => {
        const index = 848 - offset;
        return {
          mediaVersionId: current.id, segmentIndex: index, startMs: index * 1_000, endMs: (index + 1) * 1_000,
          sourceText: "Hola.", translation: "你好。", speaker: null,
          reviewStatus: index === 250 ? "pending" as const : "approved" as const,
          words: [{ text: "Hola", startOffset: 0, endOffset: 4, startMs: index * 1_000, endMs: (index + 1) * 1_000 }],
        };
      }),
      { mediaVersionId: versions.find((version) => version.version === 1)!.id, segmentIndex: 0, startMs: 0, endMs: 1_000, sourceText: "Old version", reviewStatus: "approved" },
    ]);
    repository = createDrizzleMediaRepository(database as unknown as Database);
  }, 30_000);
  afterAll(async () => { await client?.close(); });

  it("returns every approved cue from only the current version, ordered with tail word timings", async () => {
    const playback = await repository.getPlayback(stableKey, userId, new Date("2026-10-14"));
    expect(playback.segments).toHaveLength(848);
    expect(playback.segments.map((segment) => segment.index)).toEqual(Array.from({ length: 849 }, (_, index) => index).filter((index) => index !== 250));
    expect(playback.segments.at(-1)).toMatchObject({ index: 848, endMs: 849_000, words: [{ text: "Hola", startMs: 848_000, endMs: 849_000, startOffset: 0, endOffset: 4 }] });
    expect(playback.segments.some((segment) => segment.sourceText === "Old version")).toBe(false);
    expect(playback.media.progress).toBeNull();
  });
});
