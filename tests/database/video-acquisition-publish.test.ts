// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createVideoCandidateDraft } from "@/src/modules/content-acquisition";
import { AcquiredVideoPersistenceConflictError, createDrizzleMediaRepository } from "@/src/modules/media";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const candidateId = "00000000-0000-4000-8000-000000000851";

async function setupDatabase() {
  const client = new PGlite();
  await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
  for (const name of [
    "0000_big_phalanx.sql",
    "0024_media_library_foundation.sql",
    "0025_youtube_video_publication.sql",
    "0026_brief_toro.sql",
  ]) {
    const sql = (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
    await client.exec(sql);
  }
  return { client, database: drizzle(client, { schema }) };
}

function draft() {
  return createVideoCandidateDraft({
    stableKey: "youtube.publicvideo1", platform: "youtube", platformVideoId: "publicVideo1", sourceChannelId: "UCabcdefghijklmnopqrstuv",
    canonicalUrl: "https://www.youtube.com/watch?v=publicVideo1", embedUrl: "https://www.youtube-nocookie.com/embed/publicVideo1?enablejsapi=1",
    title: "Cómo pedir un café", summary: "Una conversación breve.", sourceName: "Español con calma", language: "es", region: "es-ES", cefr: "A2", topics: ["topic.daily-life"], durationMs: 245_000,
    publicationDate: "2026-09-13T08:00:00.000Z", fetchedAt: "2026-09-13T10:00:00.000Z", license: "licensed", attribution: "Español con calma en YouTube", licenseEvidence: "https://www.youtube.com/t/terms", copyrightStatus: "cleared",
    captionStatus: "platform_manual", segments: [{ index: 0, startMs: 0, endMs: 1_800, sourceText: "Buenos días.", translation: "早上好。", speaker: null, confidence: null, sourceKind: "platform_manual" }], changeReason: "Reviewed YouTube candidate.",
  });
}

const reviews = [
  { locale: "es-ES" as const, reviewerReference: "codex-ai-owner-authorized-review" as const, notes: "Contenido revisado.", reviewedAt: new Date("2026-09-13T11:00:00.000Z") },
  { locale: "zh-CN" as const, reviewerReference: "codex-ai-owner-authorized-review" as const, notes: "教学说明已复核。", reviewedAt: new Date("2026-09-13T11:00:00.000Z") },
] as const;

const hostedVideoAsset = {
  providerKey: "bunny-storage" as const,
  playbackUrl: "https://video.example.b-cdn.net/media/youtube.publicvideo1/video.mp4",
  mimeType: "video/mp4" as const,
  sha256: "a".repeat(64),
  byteSize: 1024,
};

describe("reviewed YouTube video publication persistence", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  beforeEach(async () => { ({ client, database } = await setupDatabase()); }, 20_000);
  afterEach(async () => client?.close());
  const repository = () => createDrizzleMediaRepository(database as unknown as Database);

  it("publishes idempotently with candidate provenance, official embed, segments, and reviews", async () => {
    const video = draft();
    const input = { candidateId, candidateRevision: 5, contentHash: video.contentHash, draft: video, hostedAsset: hostedVideoAsset, reviews, publishedAt: new Date("2026-09-13T12:00:00.000Z") };
    const first = await repository().publishAcquiredVideo(input);
    await expect(repository().publishAcquiredVideo(input)).resolves.toEqual(first);
    expect(first).toEqual({ kind: "media", stableKey: video.stableKey, version: 1 });
    await expect(repository().getPlayback(video.stableKey, "00000000-0000-4000-8000-000000000001", new Date("2026-09-13T13:00:00.000Z"))).resolves.toMatchObject({
      asset: { kind: "video", url: hostedVideoAsset.playbackUrl },
      segments: [{ sourceText: "Buenos días." }],
    });
    const [version] = await database.select().from(schema.mediaVersions).where(eq(schema.mediaVersions.acquisitionCandidateId, candidateId));
    expect(version).toMatchObject({ acquisitionCandidateRevision: 5, fetchedAt: new Date(video.fetchedAt), changeReason: video.changeReason });
    const [reviewCount] = await database.select({ value: count() }).from(schema.contentReviews).where(eq(schema.contentReviews.entityType, "media"));
    expect(reviewCount?.value).toBe(2);
    await expect(repository().publishAcquiredVideo({ ...input, contentHash: "f".repeat(64) })).rejects.toBeInstanceOf(AcquiredVideoPersistenceConflictError);
  });

  it("archives only the publication owned by the candidate and removes it from public playback", async () => {
    const video = draft();
    const publication = await repository().publishAcquiredVideo({ candidateId, candidateRevision: 5, contentHash: video.contentHash, draft: video, hostedAsset: hostedVideoAsset, reviews, publishedAt: new Date("2026-09-13T12:00:00.000Z") });
    await repository().archiveAcquiredVideo({ candidateId, publication, archivedAt: new Date("2026-09-13T14:00:00.000Z") });
    await expect(repository().list({ pageSize: 24, sort: "recently_added" })).resolves.toMatchObject({ items: [] });
    await expect(repository().archiveAcquiredVideo({ candidateId: "00000000-0000-4000-8000-000000000899", publication, archivedAt: new Date("2026-09-13T15:00:00.000Z") })).rejects.toBeInstanceOf(AcquiredVideoPersistenceConflictError);
  });
});
