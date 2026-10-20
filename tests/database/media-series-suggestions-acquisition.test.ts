// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertCandidatePublishable, createDrizzleContentAcquisitionRepository, createPodcastCandidateDraft, processCandidate } from "@/src/modules/content-acquisition";
import { proposeMediaSeriesSuggestion } from "@/src/modules/media/application/propose-media-series-suggestion";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const now = new Date("2026-10-16T00:00:00Z");

describe("unconfirmed series suggestions in acquisition persistence", () => {
  let client: PGlite;
  let repository: ReturnType<typeof createDrizzleContentAcquisitionRepository>;
  beforeAll(async () => {
    client = new PGlite();
    await client.exec("create role anon nologin; create role authenticated nologin; create schema auth; create table auth.users (id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;");
    for (const name of ["0000_big_phalanx", "0021_shallow_killmonger", "0022_empty_lenny_balinger", "0024_media_library_foundation", "0046_media_series_directory"]) {
      await client.exec((await readFile(`drizzle/${name}.sql`, "utf8")).replaceAll("--> statement-breakpoint", ""));
    }
    repository = createDrizzleContentAcquisitionRepository(drizzle(client, { schema }) as unknown as Database);
  }, 30_000);
  afterAll(async () => { await client?.close(); });

  async function setup(label: string) {
    const source = await repository.registerSource({ id: randomUUID(), stableKey: `fixture.suggestions.${label}`, adapterType: "fake", sourceKind: "podcast-feed", externalSourceId: `https://${label}.example.test/feed.xml`, displayName: "Programa", language: "es", region: "es-ES", enabled: true, rightsStatus: "verified", rightsPolicy: {}, schedule: {}, rateLimit: {}, cursor: null });
    const runId = randomUUID();
    await repository.createRun({ id: runId, sourceId: source.id, generationId: "generation-1", initialCursor: null, startedAt: now });
    const draft = createPodcastCandidateDraft({
      stableKey: `podcast.suggestions.${label}`, feedUrl: source.externalSourceId, episodeGuid: "episode-0", canonicalUrl: `https://${label}.example.test/episode/0`, enclosureUrl: `https://${label}.example.test/episode.mp3`, enclosureMimeType: "audio/mpeg", enclosureByteSize: 128, playbackExpiresAt: null,
      title: "Una mañana", summary: "Una conversación.", sourceName: "Programa", language: "es", region: "es-ES", cefr: "A2", topics: ["topic.daily-life"], durationMs: 60_000, publicationDate: now.toISOString(), fetchedAt: now.toISOString(), license: "licensed", attribution: "Fixture", licenseEvidence: `https://${label}.example.test/license`, copyrightStatus: "cleared", transcriptStatus: "unavailable", transcriptUrl: null, segments: [], changeReason: "Fixture discovery",
    });
    const suggestion = proposeMediaSeriesSuggestion({ sourceStableKey: source.stableKey, mediaStableKey: draft.stableKey, kind: "podcast", basis: "podcast_feed", externalSeriesId: draft.feedUrl, title: "Programa", sourceUrl: draft.feedUrl, seasonNumber: 0, episodeNumber: 0 });
    expect(suggestion?.status).toBe("unconfirmed");
    const candidate = { id: randomUUID(), sourceId: source.id, externalItemId: draft.episodeGuid, normalizedUrl: draft.canonicalUrl, title: draft.title, contentType: "podcast" as const, language: "es", publishedAt: now, contentHash: draft.contentHash, metadata: { podcastDraft: draft, mediaSeriesSuggestions: [suggestion!] }, rightsStatus: "verified" as const, generationId: "generation-1", discoveredAt: now };
    return { source, runId, draft, suggestion: suggestion!, candidate };
  }

  async function expectNoPublicWrites() {
    for (const table of ["media_series", "media_series_memberships", "media_series_changes", "media_items", "media_versions", "evidence_events"]) {
      const result = await client.query<{ count: number }>(`select count(*)::int as count from ${table}`);
      expect(result.rows[0].count, table).toBe(0);
    }
  }

  it("persists pending metadata, keeps the immutable draft/hash and deduplicates rediscovery", async () => {
    const { source, runId, draft, suggestion, candidate } = await setup("repeat");
    await repository.commitDiscoveryPage({ runId, sourceId: source.id, expectedSourceRevision: 1, nextCursor: "page-2", candidates: [candidate] });
    const first = await repository.findCandidateById(candidate.id);
    expect(first).toMatchObject({ status: "discovered", publicationStatus: "draft", revision: 1, contentHash: draft.contentHash, metadata: { podcastDraft: draft, mediaSeriesSuggestions: [{ suggestionKey: suggestion.suggestionKey, status: "unconfirmed", episodeNumber: 0, seasonNumber: 0 }] } });
    expect(first!.metadata.podcastDraft).not.toHaveProperty("mediaSeriesSuggestions");
    const repeatRunId = randomUUID();
    await repository.createRun({ id: repeatRunId, sourceId: source.id, generationId: "generation-2", initialCursor: "page-2", startedAt: now });
    await expect(repository.commitDiscoveryPage({ runId: repeatRunId, sourceId: source.id, expectedSourceRevision: 2, nextCursor: "page-3", candidates: [{ ...candidate, id: randomUUID(), generationId: "generation-2" }] })).resolves.toMatchObject({ inserted: 0, duplicates: 1, conflicts: 0 });
    expect(await repository.findCandidateById(candidate.id)).toEqual(first);
    expect((await repository.getCandidateReview(candidate.id))?.reviews).toEqual([]);
    await expectNoPublicWrites();
  });

  it("rolls back pending suggestions with a stale source cursor revision", async () => {
    const { source, runId, candidate } = await setup("stale-source");
    await expect(repository.commitDiscoveryPage({ runId, sourceId: source.id, expectedSourceRevision: 99, nextCursor: "stale-page", candidates: [candidate] })).rejects.toThrow("cursor changed");
    expect(await repository.findCandidateById(candidate.id)).toBeNull();
    expect((await repository.findSourceByStableKey(source.stableKey))?.cursor).toBeNull();
    await expectNoPublicWrites();
  });

  it("rejects old-generation metadata writes and still requires independent content reviews", async () => {
    const { source, runId, candidate, draft, suggestion } = await setup("generation");
    await repository.commitDiscoveryPage({ runId, sourceId: source.id, expectedSourceRevision: 1, nextCursor: "page-2", candidates: [candidate] });
    const fresh = await repository.compareAndSwapCandidate({ candidateId: candidate.id, expectedRevision: 1, expectedGenerationId: "generation-1", status: "discovered", generationId: "generation-2", updatedAt: now });
    await expect(repository.compareAndSwapCandidate({ candidateId: candidate.id, expectedRevision: fresh.revision, expectedGenerationId: "generation-1", status: "review_ready", generationId: "generation-1", metadata: { ...candidate.metadata, mediaSeriesSuggestions: [{ ...suggestion, title: "Stale programme" }] }, updatedAt: now })).rejects.toThrow();
    expect((await repository.findCandidateById(candidate.id))?.metadata).toEqual(candidate.metadata);
    let revision = fresh.revision;
    for (const type of ["screen-approved", "start-acquisition", "start-processing", "mark-review-ready"] as const) {
      revision = (await processCandidate(repository, { candidateId: candidate.id, event: { type, expectedRevision: revision, generationId: "generation-2" }, now: () => now })).revision;
    }
    const detail = (await repository.getCandidateReview(candidate.id))!;
    expect(detail.candidate).toMatchObject({ status: "review_ready", publicationStatus: "draft", contentHash: draft.contentHash });
    expect(detail.reviews).toEqual([]);
    expect(() => assertCandidatePublishable(detail.candidate, detail.reviews, { expectedRevision: revision, expectedContentHash: draft.contentHash })).toThrow("Missing content-es-ES approval");
    await expectNoPublicWrites();
  });
});
