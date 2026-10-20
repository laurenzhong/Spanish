// @vitest-environment node
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDrizzleMediaRepository, type MediaBrowseQuery } from "@/src/modules/media";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const userA = "00000000-0000-4000-8000-0000000000b1";
const userB = "00000000-0000-4000-8000-0000000000b2";
const query: MediaBrowseQuery = { filters: { kind: "podcast", cefr: "B1", topic: "daily-life", region: "es-ES" }, seed: "00000000-0000-4000-8000-000000000001", exclude: [], pageSize: 12 };
describe("media browse persistence and visibility", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ReturnType<typeof createDrizzleMediaRepository>;
  beforeAll(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
    for (const name of ["0000_big_phalanx.sql", "0024_media_library_foundation.sql", "0025_youtube_video_publication.sql", "0026_brief_toro.sql", "0027_pale_colossus.sql", "0041_media_cefr_four_levels.sql", "0046_media_series_directory.sql"]) {
      await client.exec((await readFile(`drizzle/${name}`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    database = drizzle(client, { schema });
    await client.exec(`insert into auth.users (id) values ('${userA}'), ('${userB}'); insert into profiles (id) values ('${userA}'), ('${userB}');`);
    for (let index = 0; index < 34; index += 1) {
      const [item] = await database.insert(schema.mediaItems).values({ stableKey: `media.browse.${index}`, kind: "podcast", currentVersion: 1 }).returning();
      const [version] = await database.insert(schema.mediaVersions).values({
        mediaItemId: item.id, version: 1, title: `Episode ${index}`, sourceName: `Source ${index % 3}`,
        durationMs: 120_000, curatedAt: new Date(`2026-10-13T00:00:${String(index).padStart(2, "0")}Z`),
        status: index === 30 ? "draft" : "published", copyrightStatus: index === 31 ? "restricted" : "cleared",
        region: "es-ES", cefr: index === 33 ? "A2" : "B1", topics: ["topic.daily-life"],
        contentHash: "a".repeat(64), license: "licensed", attribution: "Fixture", licenseEvidence: "https://fixture.test/license",
      }).returning();
      await database.insert(schema.mediaAssets).values({ mediaVersionId: version.id, kind: "official_embed", providerKey: "fixture", playbackUrl: "https://fixture.test/play", availability: index === 32 ? "withdrawn" : "available" });
      if (index < 30) await database.insert(schema.userMediaProgress).values([
        { userId: userA, mediaVersionId: version.id, lastPositionMs: 1000 },
        { userId: userB, mediaVersionId: version.id, lastPositionMs: 2000 },
      ]);
    }
    repository = createDrizzleMediaRepository(database as unknown as Database);
  }, 30_000);
  afterAll(async () => { await client?.close(); });

  it("reads the full matching pool, excludes previous cards and pages without duplication", async () => {
    const first = await repository.browse({ ...query, exclude: ["media.browse.0", "media.browse.1"] }, userA);
    const second = await repository.browse({ ...query, exclude: ["media.browse.0", "media.browse.1"], cursor: first.nextCursor! }, userA);
    const third = await repository.browse({ ...query, exclude: ["media.browse.0", "media.browse.1"], cursor: second.nextCursor! }, userA);
    const cards = [...first.items, ...second.items, ...third.items];
    expect(cards).toHaveLength(28);
    expect(new Set(cards.map((card) => card.stableKey)).size).toBe(28);
    expect(cards.every((card) => Number(card.stableKey.split(".").at(-1)) < 30)).toBe(true);
    expect(cards.every((card) => card.progress?.lastPositionMs === 1000)).toBe(true);
    expect(third.hasMore).toBe(false);
  });

  it("reads progress for the requesting user only and never caches it", async () => {
    const a = await repository.browse(query, userA);
    const b = await repository.browse(query, userB);
    expect(a.items.map((card) => card.id)).toEqual(b.items.map((card) => card.id));
    expect(b.items.every((card) => card.progress?.lastPositionMs === 2000)).toBe(true);
    await database.update(schema.userMediaProgress).set({ lastPositionMs: 3000 }).where(eq(schema.userMediaProgress.userId, userA));
    const fresh = await repository.browse(query, userA);
    expect(fresh.items.every((card) => card.progress?.lastPositionMs === 3000)).toBe(true);
  });

  it("revalidates withdrawn content and invalidates affected batch cursors", async () => {
    const first = await repository.browse(query, userA);
    const target = first.items[0].stableKey;
    await database.update(schema.mediaVersions).set({ status: "archived" }).where(eq(schema.mediaVersions.title, first.items[0].title));
    await expect(repository.browse({ ...query, cursor: first.nextCursor! }, userA)).rejects.toThrow("MEDIA_CURSOR_INVALID");
    const next = await repository.browse({ ...query, pageSize: 50 }, userA);
    expect(next.items.some((card) => card.stableKey === target)).toBe(false);
    expect(next.items).toHaveLength(29);
  });
});
