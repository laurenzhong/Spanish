// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPodcastCandidateDraft } from "@/src/modules/content-acquisition";
import { AcquiredPodcastPersistenceConflictError, createDrizzleMediaRepository } from "@/src/modules/media";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const candidateId = "00000000-0000-4000-8000-000000000951";

async function setupDatabase() {
  const client = new PGlite();
  await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;");
  // 0027 adds the artwork columns the media repository reads, 0033 the hosted
  // audio expiry policy, and 0034 the segment word timings.
  for (const name of ["0000_big_phalanx.sql", "0024_media_library_foundation.sql", "0025_youtube_video_publication.sql", "0026_brief_toro.sql", "0027_pale_colossus.sql", "0033_bunny_storage_audio_expiry.sql", "0034_media_word_timings.sql"]) {
    const sql = (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "");
    await client.exec(sql);
  }
  return { client, database: drizzle(client, { schema }) };
}

function draft() {
  return createPodcastCandidateDraft({
    stableKey: "podcast.episode42", feedUrl: "https://podcast.example.test/feed.xml", episodeGuid: "episode-42",
    canonicalUrl: "https://podcast.example.test/episodes/42", enclosureUrl: "https://media.example.test/42.mp3",
    enclosureMimeType: "audio/mpeg", enclosureByteSize: 128, playbackExpiresAt: "2026-09-21T10:00:00.000Z",
    title: "Una mañana en el mercado", summary: "Una charla breve.", sourceName: "Café de cada día", language: "es",
    region: "es-ES", cefr: "A2", topics: ["topic.daily-life"], durationMs: 360_000,
    publicationDate: "2026-09-13T08:00:00.000Z", fetchedAt: "2026-09-14T10:00:00.000Z", license: "licensed",
    attribution: "Café de cada día", licenseEvidence: "https://podcast.example.test/license", copyrightStatus: "cleared",
    transcriptStatus: "platform_manual", transcriptUrl: "https://transcripts.example.test/42.vtt",
    segments: [{ index: 0, startMs: 0, endMs: 2_200, sourceText: "Buenos días.", translation: null, speaker: null, confidence: null, sourceKind: "platform_manual" }],
    changeReason: "Reviewed podcast candidate.",
  });
}

const reviews = [
  { locale: "es-ES" as const, reviewerReference: "codex-ai-owner-authorized-review" as const, notes: "Contenido revisado.", reviewedAt: new Date("2026-09-14T11:00:00.000Z") },
  { locale: "zh-CN" as const, reviewerReference: "codex-ai-owner-authorized-review" as const, notes: "教学说明已复核。", reviewedAt: new Date("2026-09-14T11:00:00.000Z") },
] as const;

describe("reviewed podcast publication persistence", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  beforeEach(async () => { ({ client, database } = await setupDatabase()); }, 20_000);
  afterEach(async () => client?.close());
  const repository = () => createDrizzleMediaRepository(database as unknown as Database);

  it("publishes idempotently with RSS provenance, expiring enclosure, transcript, and reviews", async () => {
    const podcast = draft();
    const input = { candidateId, candidateRevision: 5, contentHash: podcast.contentHash, draft: podcast, reviews, publishedAt: new Date("2026-09-14T12:00:00.000Z") };
    const first = await repository().publishAcquiredPodcast(input);
    await expect(repository().publishAcquiredPodcast(input)).resolves.toEqual(first);
    expect(first).toEqual({ kind: "media", stableKey: podcast.stableKey, version: 1 });
    await expect(repository().getPlayback(podcast.stableKey, "00000000-0000-4000-8000-000000000001", new Date("2026-09-14T13:00:00.000Z"))).resolves.toMatchObject({
      media: { kind: "podcast" }, asset: { kind: "audio", url: podcast.enclosureUrl, expiresAt: podcast.playbackExpiresAt },
      segments: [{ sourceText: "Buenos días." }],
    });
    const [version] = await database.select().from(schema.mediaVersions).where(eq(schema.mediaVersions.acquisitionCandidateId, candidateId));
    expect(version).toMatchObject({
      platformSourceId: podcast.episodeGuid,
      sourceFeedUrl: podcast.feedUrl,
      enclosureUrlHash: podcast.enclosureUrlHash,
      acquisitionCandidateRevision: 5,
    });
    const [reviewCount] = await database.select({ value: count() }).from(schema.contentReviews).where(eq(schema.contentReviews.entityType, "media"));
    expect(reviewCount?.value).toBe(2);
    await expect(repository().publishAcquiredPodcast({ ...input, contentHash: "f".repeat(64) })).rejects.toBeInstanceOf(AcquiredPodcastPersistenceConflictError);
  });

  it("persists the durable artwork snapshot instead of the draft's remote URL", async () => {
    const podcast = draft();
    const draftArtwork = { url: "https://cdn.example.test/cover.jpg", alt: "Portada", source: "podcast-feed" as const, width: 1400, height: 1400, expiresAt: "2026-09-20T00:00:00.000Z" };
    const durableArtwork = { url: "https://sueno-media.b-cdn.net/media/artwork/podcast.episode42/v5-abc.jpg", alt: "Portada", source: "podcast-feed" as const, width: 1400, height: 1400, expiresAt: null };
    const withArtwork = { ...podcast, artwork: draftArtwork };

    await repository().publishAcquiredPodcast({
      candidateId,
      candidateRevision: 5,
      contentHash: withArtwork.contentHash,
      draft: withArtwork,
      artworkOverride: durableArtwork,
      reviews,
      publishedAt: new Date("2026-09-14T12:00:00.000Z"),
    });

    const [version] = await database.select().from(schema.mediaVersions).where(eq(schema.mediaVersions.acquisitionCandidateId, candidateId));
    expect(version).toMatchObject({
      artworkUrl: durableArtwork.url,
      artworkAlt: durableArtwork.alt,
      artworkSource: durableArtwork.source,
      artworkWidth: 1400,
      artworkHeight: 1400,
      artworkExpiresAt: null,
    });
  });

  it("expires playback and archives only the candidate-owned podcast publication", async () => {
    const podcast = draft();
    const publication = await repository().publishAcquiredPodcast({ candidateId, candidateRevision: 5, contentHash: podcast.contentHash, draft: podcast, reviews, publishedAt: new Date("2026-09-14T12:00:00.000Z") });
    await expect(repository().getPlayback(podcast.stableKey, "00000000-0000-4000-8000-000000000001", new Date("2026-09-22T13:00:00.000Z"))).rejects.toThrow();
    await repository().archiveAcquiredPodcast({ candidateId, publication, archivedAt: new Date("2026-09-14T14:00:00.000Z") });
    await expect(repository().list({ pageSize: 24, sort: "recently_added" })).resolves.toMatchObject({ items: [] });
    await expect(repository().archiveAcquiredPodcast({ candidateId: "00000000-0000-4000-8000-000000000999", publication, archivedAt: new Date("2026-09-14T15:00:00.000Z") })).rejects.toBeInstanceOf(AcquiredPodcastPersistenceConflictError);
  });
});
