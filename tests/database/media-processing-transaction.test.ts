// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleContentAcquisitionRepository,
  createPodcastCandidateDraft,
  type ContentAcquisitionRepository,
} from "@/src/modules/content-acquisition";
import { assertCandidatePublishable, ContentReviewIncompleteError } from "@/src/modules/content-acquisition/domain";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const sourceId = "00000000-0000-4000-8000-000000000701";
const candidateId = "00000000-0000-4000-8000-000000000702";
const artifactId = "00000000-0000-4000-8000-000000000703";
const audioHash = "f".repeat(64);

async function acquisitionMigration(): Promise<string> {
  const names = (await readdir(path.join(process.cwd(), "drizzle")))
    .filter((name) => /^002[12]_.+\.sql$/u.test(name)).sort();
  return (await Promise.all(names.map((name) => readFile(path.join(process.cwd(), "drizzle", name), "utf8"))))
    .join("\n").replaceAll("--> statement-breakpoint", "");
}

describe("media processing transaction", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;
  let repository: ContentAcquisitionRepository;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(await acquisitionMigration());
    database = drizzle(client, { schema });
    repository = createDrizzleContentAcquisitionRepository(database as unknown as Database);
    await repository.registerSource({
      id: sourceId,
      stableKey: "fixture.media.processing",
      adapterType: "fake",
      sourceKind: "podcast-feed",
      externalSourceId: "fixture-feed",
      displayName: "Fixture media processing",
      language: "es",
      region: "es-ES",
      enabled: true,
      rightsStatus: "verified",
      rightsPolicy: {},
      schedule: {},
      rateLimit: {},
      cursor: null,
    });
    await repository.createRun({ id: "00000000-0000-4000-8000-000000000704", sourceId, generationId: "generation-1", initialCursor: null, startedAt: new Date("2026-09-15T00:00:00.000Z") });
    const podcastDraft = createPodcastCandidateDraft({
      stableKey: "podcast.fixture.processing", feedUrl: "https://fixture.example.test/feed.xml", episodeGuid: "episode-1", canonicalUrl: "https://fixture.example.test/episode-1", enclosureUrl: "https://fixture.example.test/episode-1.mp3", enclosureMimeType: "audio/mpeg", enclosureByteSize: 128, playbackExpiresAt: "2026-09-30T00:00:00.000Z", title: "Episode 1", summary: "Fixture", sourceName: "Fixture", language: "es", region: "es-ES", cefr: "A2", topics: ["topic.fixture"], durationMs: 10_000, publicationDate: "2026-09-15T00:00:00.000Z", fetchedAt: "2026-09-15T00:00:00.000Z", license: "licensed", attribution: "Fixture", licenseEvidence: "https://fixture.example.test/license", copyrightStatus: "cleared", transcriptStatus: "unavailable", transcriptUrl: null, segments: [], changeReason: "fixture",
    });
    await repository.commitDiscoveryPage({
      runId: "00000000-0000-4000-8000-000000000704",
      sourceId,
      expectedSourceRevision: 1,
      nextCursor: null,
      candidates: [{
        id: candidateId,
        sourceId,
        externalItemId: "episode-1",
        normalizedUrl: "https://fixture.example.test/episode-1",
        title: "Episode 1",
        contentType: "podcast",
        language: "es",
        publishedAt: null,
        contentHash: "a".repeat(64),
        metadata: { podcastDraft },
        rightsStatus: "verified",
        generationId: "generation-1",
        discoveredAt: new Date("2026-09-15T00:00:00.000Z"),
      }],
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it("commits an immutable transcript draft and ephemeral artifact idempotently", async () => {
    const currentCandidate = await repository.findCandidateById(candidateId);
    expect(currentCandidate).toMatchObject({ revision: 1, generationId: "generation-1" });
    const commit = {
      candidateId,
      expectedRevision: currentCandidate!.revision,
      generationId: currentCandidate!.generationId,
      artifactId,
      artifactStorageKey: "ephemeral/candidate-1.mp3",
      audioHash,
      byteSize: 128,
      draft: {
        audioHash,
        segments: [{ index: 0, startMs: 0, endMs: 1_000, sourceText: "Hola.", translation: null, speaker: null, confidence: 0.72, sourceKind: "asr" as const }],
        provider: "fake",
        modelVersion: "fake-v1",
        lowConfidence: true,
        createdAt: new Date("2026-09-15T00:01:00.000Z"),
      },
    };
    const mediaRepository = repository as typeof repository & { commitMediaTranscriptDraft: (input: typeof commit) => Promise<void> };
    await mediaRepository.commitMediaTranscriptDraft(commit);
    await mediaRepository.commitMediaTranscriptDraft(commit);

    const [candidate] = await database.select().from(schema.contentCandidates).where(eq(schema.contentCandidates.id, candidateId));
    const artifacts = await database.select().from(schema.candidateArtifacts).where(and(eq(schema.candidateArtifacts.candidateId, candidateId), eq(schema.candidateArtifacts.contentHash, audioHash)));
    expect(candidate.metadata).toMatchObject({ mediaTranscriptReviewStatus: "blocked-low-confidence", mediaTranscriptDraft: { audioHash, provider: "fake" } });
    expect(candidate.metadata).toHaveProperty("mediaTranscriptDraftHistory", []);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ artifactType: "asr-temporary-audio", ephemeral: true, status: "available" });
  });

  it("keeps low-confidence drafts outside publication", () => {
    expect(() => assertCandidatePublishable({
      id: candidateId,
      contentType: "podcast",
      status: "review_ready",
      rightsStatus: "verified",
      revision: 1,
      contentHash: "a".repeat(64),
      publicationStatus: "draft",
      metadata: { mediaTranscriptDraft: { lowConfidence: true } },
    }, [
      { id: "review-1", candidateId, dimension: "content-es-ES", status: "approved", reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 1, notes: null },
      { id: "review-2", candidateId, dimension: "teaching-zh-CN", status: "approved", reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 1, notes: null },
      { id: "review-3", candidateId, dimension: "structure", status: "approved", reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 1, notes: null },
    ], { expectedRevision: 1, expectedContentHash: "a".repeat(64) })).toThrow(ContentReviewIncompleteError);
  });
});
