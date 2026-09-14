import { describe, expect, it, vi } from "vitest";

import {
  createPodcastCandidateDraft,
  FakeContentSourceAdapter,
  type ContentAcquisitionRepository,
  type ContentCandidateRecord,
  type ContentSourceAdapter,
  type ContentSourceRecord,
} from "@/src/modules/content-acquisition";
import {
  AcquireContentCliInputError,
  parseAcquireContentArguments,
  runAcquireContentCli,
} from "@/scripts/acquire-content";

function dryRunRepository(): ContentAcquisitionRepository {
  const source = {
    id: "00000000-0000-4000-8000-000000000601",
    stableKey: "fixture.spanish.daily",
    adapterType: "fake",
    sourceKind: "video-channel",
    externalSourceId: "fixture-channel",
    displayName: "Fixture Spanish",
    language: "es",
    region: "es-ES",
    enabled: true,
    rightsStatus: "verified",
    cursor: "page-1",
    revision: 1,
  } satisfies ContentSourceRecord;
  return {
    registerSource: vi.fn(),
    findSourceByStableKey: vi.fn(async () => source),
    createRun: vi.fn(async () => { throw new Error("dry-run must not create a run"); }),
    commitDiscoveryPage: vi.fn(async () => { throw new Error("dry-run must not commit candidates"); }),
    completeRun: vi.fn(async () => { throw new Error("dry-run must not complete a run"); }),
    failRun: vi.fn(async () => { throw new Error("dry-run must not fail a run"); }),
    findCandidateById: vi.fn(),
    compareAndSwapCandidate: vi.fn(),
    recordProcessingAttempt: vi.fn(),
  };
}

describe("content acquisition CLI", () => {
  it("fails closed when no source is explicit or an argument is unsupported", () => {
    expect(() => parseAcquireContentArguments(["--", "--dry-run"])).toThrow(AcquireContentCliInputError);
    expect(() => parseAcquireContentArguments(["--source", "fixture", "--all"])).toThrow(
      AcquireContentCliInputError,
    );
  });

  it("parses the supported source, dry-run and limit flags", () => {
    expect(parseAcquireContentArguments([
      "--",
      "--source",
      "fixture.spanish.daily",
      "--dry-run",
      "--limit",
      "2",
    ])).toEqual({ sourceStableKey: "fixture.spanish.daily", dryRun: true, limit: 2 });
  });

  it("prints only the internal run summary, step states, counts and estimated cost", async () => {
    const output: string[] = [];
    await runAcquireContentCli([
      "--source",
      "fixture.spanish.daily",
      "--dry-run",
      "--limit",
      "1",
    ], {
      repository: dryRunRepository(),
      adapter: new FakeContentSourceAdapter([{
        sourceStableKey: "fixture.spanish.daily",
        cursor: "page-1",
        nextCursor: "page-2",
        estimatedCostMicros: 25,
        items: [{
          externalItemId: "video-1",
          canonicalUrl: "https://example.test/video-1",
          title: "Fixture",
          contentType: "video",
          language: "es",
          publishedAt: null,
          contentHash: null,
          metadata: {},
        }],
      }]),
      write: (line) => output.push(line),
    });

    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0]!)).toEqual({
      runId: expect.any(String),
      status: "succeeded",
      steps: { discovery: "completed", persistence: "skipped" },
      counts: { discovered: 1, inserted: 0, duplicates: 0, conflicts: 0 },
      estimatedCostMicros: 25,
    });
    expect(output[0]).not.toContain("fixture.spanish.daily");
    expect(output[0]).not.toContain("page-2");
  });

  it("prepares newly inserted podcast RSS candidates for owner review without ASR", async () => {
    const draft = createPodcastCandidateDraft({
      stableKey: "podcast.episode42",
      feedUrl: "https://podcast.example.test/feed.xml",
      episodeGuid: "episode-42",
      canonicalUrl: "https://podcast.example.test/episodes/42",
      enclosureUrl: "https://media.example.test/episode-42.mp3",
      enclosureMimeType: "audio/mpeg",
      enclosureByteSize: 128,
      playbackExpiresAt: "2030-09-21T10:00:00.000Z",
      title: "Una mañana en el mercado",
      summary: "Una charla breve.",
      sourceName: "Café de cada día",
      language: "es",
      region: "es-ES",
      cefr: "A2",
      topics: ["topic.daily-life"],
      durationMs: 360_000,
      publicationDate: "2026-09-13T08:00:00.000Z",
      fetchedAt: "2026-09-14T10:00:00.000Z",
      license: "licensed",
      attribution: "Café de cada día",
      licenseEvidence: "https://podcast.example.test/license",
      copyrightStatus: "cleared",
      transcriptStatus: "unavailable",
      transcriptUrl: null,
      segments: [],
      changeReason: "Fixture podcast discovery.",
    });
    const source: ContentSourceRecord = {
      id: "00000000-0000-4000-8000-000000000611",
      stableKey: "podcast.cafe-diario",
      adapterType: "podcast-rss",
      sourceKind: "podcast-feed",
      externalSourceId: draft.feedUrl,
      displayName: draft.sourceName,
      language: "es",
      region: "es-ES",
      enabled: true,
      rightsStatus: "verified",
      cursor: null,
      revision: 1,
    };
    let candidate: ContentCandidateRecord | null = null;
    const recordProcessingAttempt = vi.fn(async () => undefined);
    const repository = {
      registerSource: vi.fn(),
      findSourceByStableKey: vi.fn(async () => source),
      createRun: vi.fn(async () => undefined),
      commitDiscoveryPage: vi.fn(async (input) => {
        const inserted = input.candidates[0]!;
        candidate = {
          ...inserted,
          status: "discovered",
          revision: 1,
          lastActivityAt: inserted.discoveredAt,
          rejectedAt: null,
          publicationStatus: "draft",
          publicationRef: null,
          publishedCandidateRevision: null,
          publishedContentHash: null,
          publishedAtInternal: null,
          archivedAt: null,
        };
        return { inserted: 1, duplicates: 0, conflicts: 0, insertedCandidateIds: [inserted.id] };
      }),
      completeRun: vi.fn(async () => undefined),
      failRun: vi.fn(async () => undefined),
      findCandidateById: vi.fn(async () => candidate),
      compareAndSwapCandidate: vi.fn(async (input) => {
        candidate = { ...candidate!, status: input.status, revision: input.expectedRevision + 1, lastActivityAt: input.updatedAt };
        return candidate;
      }),
      recordProcessingAttempt,
    } satisfies ContentAcquisitionRepository;
    const adapter: ContentSourceAdapter = {
      key: "podcast-rss",
      discover: vi.fn(async (input) => ({
        sourceStableKey: input.sourceStableKey,
        cursor: input.cursor,
        nextCursor: "episode-42",
        estimatedCostMicros: 0,
        items: [{
          externalItemId: draft.episodeGuid,
          canonicalUrl: draft.canonicalUrl,
          title: draft.title,
          contentType: "podcast" as const,
          language: "es",
          publishedAt: draft.publicationDate,
          contentHash: draft.contentHash,
          metadata: { podcastDraft: draft },
        }],
      })),
    };
    const output: string[] = [];

    await runAcquireContentCli(["--source", source.stableKey, "--limit", "1"], {
      repository,
      adapter,
      write: (line) => output.push(line),
    });

    expect(candidate).toMatchObject({ status: "review_ready", revision: 5 });
    expect(recordProcessingAttempt).toHaveBeenCalledWith(expect.objectContaining({
      jobType: "podcast-metadata-normalization",
      estimatedCostMicros: 0,
      status: "succeeded",
    }));
    expect(JSON.parse(output[0]!)).toMatchObject({
      steps: { discovery: "completed", persistence: "completed", processing: "completed" },
      counts: { discovered: 1, inserted: 1, reviewReady: 1 },
    });
  });
});
