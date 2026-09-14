// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createPodcastCandidateDraft,
  processMediaCandidate,
  type ContentAcquisitionRepository,
  type ContentCandidateRecord,
  type ContentSourceRecord,
} from "@/src/modules/content-acquisition";
import { FakeMediaTranscriptionProvider, FakeMediaTranslationProvider, type MediaProcessingArtifactStore } from "@/src/modules/media-processing";

const policy = { maxDurationMs: 30 * 60 * 1_000, maxAssetBytes: 50_000_000, maxEstimatedCostMicros: 2_000_000, minimumConfidence: 0.72 };

function makeDraft() {
  return createPodcastCandidateDraft({
    stableKey: "podcast.episode42", feedUrl: "https://podcast.example.test/feed.xml", episodeGuid: "episode-42", canonicalUrl: "https://podcast.example.test/episodes/42", enclosureUrl: "https://media.example.test/42.mp3", enclosureMimeType: "audio/mpeg", enclosureByteSize: 128, playbackExpiresAt: "2026-09-21T10:00:00.000Z", title: "Una mañana en el mercado", summary: "Una charla breve.", sourceName: "Café de cada día", language: "es", region: "es-ES", cefr: "A2", topics: ["topic.daily-life"], durationMs: 8_000, publicationDate: "2026-09-13T08:00:00.000Z", fetchedAt: "2026-09-14T10:00:00.000Z", license: "licensed", attribution: "Café de cada día", licenseEvidence: "https://podcast.example.test/license", copyrightStatus: "cleared", transcriptStatus: "unavailable", transcriptUrl: null, segments: [], changeReason: "First fetch.",
  });
}

function makeCandidate(draft = makeDraft()): ContentCandidateRecord {
  return {
    id: "00000000-0000-4000-8000-000000000921", sourceId: "00000000-0000-4000-8000-000000000922", externalItemId: draft.episodeGuid, normalizedUrl: draft.canonicalUrl, title: draft.title, contentType: "podcast", language: "es", publishedAt: new Date(draft.publicationDate), contentHash: draft.contentHash, metadata: { podcastDraft: draft }, rightsStatus: "verified", status: "processing", generationId: "generation-1", revision: 3, lastActivityAt: new Date("2026-09-14T10:00:00.000Z"), rejectedAt: null, publicationStatus: "draft", publicationRef: null, publishedCandidateRevision: null, publishedContentHash: null, publishedAtInternal: null, archivedAt: null,
  };
}

const source: ContentSourceRecord = { id: "00000000-0000-4000-8000-000000000922", stableKey: "podcast-source", adapterType: "fake", sourceKind: "podcast-feed", externalSourceId: "feed", displayName: "Café", language: "es", region: "es-ES", enabled: true, rightsStatus: "verified", cursor: null, revision: 1 };

function makeRepository(candidate: ContentCandidateRecord) {
  let current = candidate;
  const attempts: unknown[] = [];
  const compareAndSwapCandidate = vi.fn(async (input: Parameters<ContentAcquisitionRepository["compareAndSwapCandidate"]>[0]) => {
    expect(input.expectedRevision).toBe(current.revision);
    current = { ...current, status: input.status, metadata: input.metadata ?? current.metadata, contentHash: input.contentHash ?? current.contentHash, revision: current.revision + 1, lastActivityAt: input.updatedAt };
    return current;
  });
  const repository = { findCandidateById: vi.fn(async () => current), findSourceById: vi.fn(async () => source), compareAndSwapCandidate, recordProcessingAttempt: vi.fn(async (input) => { attempts.push(input); }) } as unknown as ContentAcquisitionRepository;
  return { repository, attempts, compareAndSwapCandidate, getCurrent: () => current };
}

function artifactStore(): MediaProcessingArtifactStore {
  return { acquire: vi.fn(async () => ({ id: "temporary-1", path: "tmp/audio", byteSize: 128 })), delete: vi.fn(async () => undefined) };
}

describe("processMediaCandidate", () => {
  it("updates podcast ASR draft with a new content hash and CAS revision", async () => {
    const state = makeRepository(makeCandidate());
    const updated = await processMediaCandidate(state.repository, "00000000-0000-4000-8000-000000000921", {
      policy, artifactStore: artifactStore(), transcriptionProvider: new FakeMediaTranscriptionProvider([
        { type: "segment", segment: { startMs: 0, endMs: 900, text: "Hola", confidence: 0.9 } },
        { type: "done", providerRequestId: "request-1", modelVersion: "fake-v1", estimatedCostMicros: 20 },
      ]), translationProvider: new FakeMediaTranslationProvider(() => "你好"), makeAttemptId: () => "00000000-0000-4000-8000-000000000923", now: () => new Date("2026-09-14T11:00:00.000Z"),
    });
    expect(updated.status).toBe("review_ready");
    expect(updated.revision).toBe(4);
    expect(updated.metadata.podcastDraft).toMatchObject({ transcriptStatus: "asr", transcriptUrl: null, segments: [{ sourceKind: "asr", translation: "你好" }] });
    expect(state.compareAndSwapCandidate).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3, status: "review_ready" }));
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({ jobType: "media-asr-translation", status: "succeeded", expectedRevision: 3 });
  });

  it("keeps low-confidence ASR in processing and records a failed attempt", async () => {
    const state = makeRepository(makeCandidate());
    const updated = await processMediaCandidate(state.repository, "00000000-0000-4000-8000-000000000921", {
      policy, artifactStore: artifactStore(), transcriptionProvider: new FakeMediaTranscriptionProvider([
        { type: "segment", segment: { startMs: 0, endMs: 900, text: "Hola", confidence: 0.2 } },
        { type: "done", providerRequestId: null, modelVersion: "fake-v1", estimatedCostMicros: 20 },
      ]), makeAttemptId: () => "00000000-0000-4000-8000-000000000924", now: () => new Date("2026-09-14T11:00:00.000Z"),
    });
    expect(updated.status).toBe("processing");
    expect(updated.metadata.podcastDraft).toMatchObject({ transcriptStatus: "asr", segments: [{ sourceKind: "asr", confidence: 0.2 }] });
    expect(state.attempts[0]).toMatchObject({ status: "failed", errorCode: "MEDIA_ASR_LOW_CONFIDENCE" });
  });
});
