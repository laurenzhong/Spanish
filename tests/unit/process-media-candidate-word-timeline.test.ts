// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  calculatePodcastCandidateContentHash,
  createPodcastCandidateDraft,
  podcastCandidateDraftSchema,
  processMediaCandidate,
  type ContentAcquisitionRepository,
  type ContentCandidateRecord,
  type ContentSourceRecord,
} from "@/src/modules/content-acquisition";
import { preparePodcastCandidateForReview } from "@/src/modules/content-acquisition/application/prepare-podcast-candidate-for-review";
import { wordTimingsForPlayback } from "@/src/modules/media/domain";
import { FakeMediaTranscriptionProvider, FakeMediaTranslationProvider, type MediaProcessingArtifactStore } from "@/src/modules/media-processing";

const policy = { maxDurationMs: 30 * 60 * 1_000, maxAssetBytes: 50_000_000, maxEstimatedCostMicros: 2_000_000, minimumConfidence: 0.72 };

function makeDraft() {
  return createPodcastCandidateDraft({
    stableKey: "podcast.episode.words",
    feedUrl: "https://podcast.example.test/feed.xml",
    episodeGuid: "episode-words",
    canonicalUrl: "https://podcast.example.test/episodes/words",
    enclosureUrl: "https://media.example.test/words.mp3",
    enclosureMimeType: "audio/mpeg",
    enclosureByteSize: 128,
    playbackExpiresAt: "2026-12-21T10:00:00.000Z",
    title: "Una mañana en el mercado",
    summary: "Una charla breve.",
    sourceName: "Café de cada día",
    language: "es",
    region: "es-ES",
    cefr: "A2",
    topics: ["topic.daily-life"],
    durationMs: 8_000,
    publicationDate: "2026-10-13T08:00:00.000Z",
    fetchedAt: "2026-10-14T10:00:00.000Z",
    license: "licensed",
    attribution: "Café de cada día",
    licenseEvidence: "https://podcast.example.test/license",
    copyrightStatus: "cleared",
    transcriptStatus: "unavailable",
    transcriptUrl: null,
    segments: [],
    changeReason: "First fetch.",
  });
}

function makeCandidate(draft = makeDraft()): ContentCandidateRecord {
  return {
    id: "00000000-0000-4000-8000-000000000941",
    sourceId: "00000000-0000-4000-8000-000000000942",
    externalItemId: draft.episodeGuid,
    normalizedUrl: draft.canonicalUrl,
    title: draft.title,
    contentType: "podcast",
    language: "es",
    publishedAt: new Date(draft.publicationDate),
    contentHash: draft.contentHash,
    metadata: { podcastDraft: draft },
    rightsStatus: "verified",
    status: "processing",
    generationId: "generation-1",
    revision: 3,
    lastActivityAt: new Date("2026-10-14T10:00:00.000Z"),
    rejectedAt: null,
    publicationStatus: "draft",
    publicationRef: null,
    publishedCandidateRevision: null,
    publishedContentHash: null,
    publishedAtInternal: null,
    archivedAt: null,
  };
}

const source: ContentSourceRecord = {
  id: "00000000-0000-4000-8000-000000000942",
  stableKey: "podcast-source",
  adapterType: "fake",
  sourceKind: "podcast-feed",
  externalSourceId: "feed",
  displayName: "Café",
  language: "es",
  region: "es-ES",
  enabled: true,
  rightsStatus: "verified",
  cursor: null,
  revision: 1,
  rightsPolicy: { mediaProcessing: { version: 1, allowedOperations: ["acquire-audio", "asr", "translate"], audience: "shared-learning", thirdPartyProcessing: true, evidenceUrl: "https://podcast.example.test/permission", expiresAt: null } },
};

function artifactStore(): MediaProcessingArtifactStore {
  return { acquire: vi.fn(async () => ({ id: "temporary-1", path: "tmp/audio", byteSize: 128 })), delete: vi.fn(async () => undefined) };
}

function makeRepository(candidate: ContentCandidateRecord) {
  let current = candidate;
  const attempts: unknown[] = [];
  const compareAndSwapCandidate = vi.fn(async (input: Parameters<ContentAcquisitionRepository["compareAndSwapCandidate"]>[0]) => {
    expect(input.expectedRevision).toBe(current.revision);
    current = {
      ...current,
      status: input.status,
      metadata: input.metadata ?? current.metadata,
      contentHash: input.contentHash ?? current.contentHash,
      revision: current.revision + 1,
      lastActivityAt: input.updatedAt,
    };
    return current;
  });
  const repository = {
    findCandidateById: vi.fn(async () => current),
    findSourceById: vi.fn(async () => source),
    compareAndSwapCandidate,
    recordProcessingAttempt: vi.fn(async (input) => { attempts.push(input); }),
  } as unknown as ContentAcquisitionRepository;
  return { repository, attempts, getCurrent: () => current };
}

describe("processMediaCandidate word timeline", () => {
  it("persists provider word timings from ASR into the podcast draft and passes the review-ready gate", async () => {
    const state = makeRepository(makeCandidate());
    const updated = await processMediaCandidate(state.repository, state.getCurrent().id, {
      policy,
      artifactStore: artifactStore(),
      transcriptionProvider: new FakeMediaTranscriptionProvider([
        {
          type: "segment",
          segment: {
            startMs: 0,
            endMs: 1_500,
            text: "Hola, ¿qué tal?",
            confidence: 0.9,
            words: [
              { startMs: 0, endMs: 400, startOffset: 0, endOffset: 4, text: "Hola" },
              { startMs: 700, endMs: 1_100, startOffset: 7, endOffset: 10, text: "qué" },
              { startMs: 1_100, endMs: 1_500, startOffset: 11, endOffset: 14, text: "tal" },
            ],
          },
        },
        {
          type: "segment",
          segment: {
            startMs: 1_600,
            endMs: 3_000,
            text: "Buenos días.",
            confidence: 0.9,
            words: [
              { startMs: 1_600, endMs: 2_200, startOffset: 0, endOffset: 6, text: "Buenos" },
              { startMs: 2_200, endMs: 3_000, startOffset: 7, endOffset: 11, text: "días" },
            ],
          },
        },
        { type: "done", providerRequestId: "request-1", modelVersion: "fake-v1", estimatedCostMicros: 20 },
      ]),
      translationProvider: new FakeMediaTranslationProvider(() => "你好，世界。"),
      makeAttemptId: () => "00000000-0000-4000-8000-000000000943",
      now: () => new Date("2026-10-14T11:00:00.000Z"),
    });

    expect(updated.status).toBe("review_ready");
    const draft = podcastCandidateDraftSchema.parse(updated.metadata.podcastDraft);
    expect(draft.segments.map((segment) => segment.words?.map((word) => word.text))).toEqual([
      ["Hola", "qué", "tal"],
      ["Buenos", "días"],
    ]);
    expect(draft.segments.every((segment) => wordTimingsForPlayback(segment).length > 0)).toBe(true);
    expect(draft.contentHash).toBe(calculatePodcastCandidateContentHash(draft));

    const prepared = await preparePodcastCandidateForReview(state.repository, state.getCurrent().id);
    expect(prepared.status).toBe("review_ready");
    expect(prepared.contentHash).toBe(draft.contentHash);
  });
});
