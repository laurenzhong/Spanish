// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { reviseMediaCandidateAfterReview } from "@/src/modules/content-acquisition/application/revise-media-candidate";
import { runMediaReview } from "@/src/modules/content-acquisition/application/run-media-review";
import {
  calculatePodcastCandidateContentHash,
  createPodcastCandidateDraft,
  podcastCandidateDraftSchema,
  type PodcastCandidateDraft,
} from "@/src/modules/content-acquisition/normalizers";
import {
  mediaReviewInputHash,
  MiniMaxMediaReviewProvider,
  projectMediaDraftForModel,
  type MediaReviewInput,
} from "@/src/modules/content-acquisition/providers/media-review";
import { MiniMaxMediaRevisionProvider, type MediaRevisionInput } from "@/src/modules/content-acquisition/providers/media-revision";
import type { ContentCandidateRecord, ContentWorkflowRepository } from "@/src/modules/content-acquisition/repositories";

const words = [
  { startMs: 0, endMs: 400, startOffset: 0, endOffset: 4, text: "Hola" },
  { startMs: 700, endMs: 1_100, startOffset: 7, endOffset: 10, text: "qué" },
  { startMs: 1_100, endMs: 1_500, startOffset: 11, endOffset: 14, text: "tal" },
] as const;

function makeDraft(): PodcastCandidateDraft {
  return createPodcastCandidateDraft({
    stableKey: "podcast.words-review",
    feedUrl: "https://podcast.example.test/feed.xml",
    episodeGuid: "episode-words-review",
    canonicalUrl: "https://podcast.example.test/episodes/words-review",
    enclosureUrl: "https://media.example.test/words-review.mp3",
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
    durationMs: 5_000,
    publicationDate: "2026-10-13T08:00:00.000Z",
    fetchedAt: "2026-10-14T10:00:00.000Z",
    license: "licensed",
    attribution: "Café de cada día",
    licenseEvidence: "https://podcast.example.test/license",
    copyrightStatus: "cleared",
    transcriptStatus: "asr",
    transcriptUrl: null,
    segments: [
      {
        index: 0,
        startMs: 0,
        endMs: 1_500,
        sourceText: "Hola, ¿qué tal?",
        translation: "你好，怎么样？",
        speaker: null,
        confidence: 0.9,
        sourceKind: "asr",
        words,
      },
      {
        index: 1,
        startMs: 1_600,
        endMs: 3_000,
        sourceText: "Buenos días.",
        translation: "早上好。",
        speaker: null,
        confidence: 0.9,
        sourceKind: "asr",
        words: [
          { startMs: 1_600, endMs: 2_200, startOffset: 0, endOffset: 6, text: "Buenos" },
          { startMs: 2_200, endMs: 3_000, startOffset: 7, endOffset: 11, text: "días" },
        ],
      },
    ],
    changeReason: "Word timeline review projection.",
  });
}

function makeCandidate(draft = makeDraft()): ContentCandidateRecord {
  return {
    id: "00000000-0000-4000-8000-000000000931",
    sourceId: "00000000-0000-4000-8000-000000000932",
    externalItemId: draft.episodeGuid,
    normalizedUrl: draft.canonicalUrl,
    title: draft.title,
    contentType: "podcast",
    language: "es",
    publishedAt: new Date(draft.publicationDate),
    contentHash: draft.contentHash,
    metadata: { podcastDraft: draft },
    rightsStatus: "verified",
    status: "review_ready",
    generationId: "generation-1",
    revision: 2,
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

function reviewInput(draft = makeDraft()): MediaReviewInput {
  return {
    candidateId: "candidate-words-review",
    candidateRevision: 2,
    contentHash: draft.contentHash,
    contentType: "podcast",
    title: draft.title,
    summary: draft.summary,
    draft,
  };
}

describe("media review word projection", () => {
  it("computes the review input hash without word timings so review payloads cannot grow", () => {
    const draft = makeDraft();
    const withWords = reviewInput(draft);
    const projected = { ...withWords, draft: projectMediaDraftForModel(draft) };

    expect(projected.draft.segments.every((segment) => !("words" in segment))).toBe(true);
    expect(projected.draft.contentHash).toBe(draft.contentHash);
    expect(mediaReviewInputHash(withWords)).toBe(mediaReviewInputHash(projected));
  });

  it("passes a word-free draft to both review providers while the structure gate validates real words", async () => {
    const candidate = makeCandidate();
    const repository = {
      getCandidateReview: vi.fn(async () => ({ candidate, source: {}, artifacts: [], attempts: [], reviews: [] })),
      saveCandidateReview: vi.fn(async (input: unknown) => input),
    } as unknown as ContentWorkflowRepository;
    const captured: MediaReviewInput[] = [];
    const provider = (dimension: "content-es-ES" | "teaching-zh-CN") => ({
      dimension,
      async review(input: MediaReviewInput) {
        captured.push(input);
        return { decision: "approved" as const, notes: "ok", modelVersion: "test", inputHash: mediaReviewInputHash(input) };
      },
    });

    const result = await runMediaReview(repository, { candidateId: candidate.id, contentProvider: provider("content-es-ES"), teachingProvider: provider("teaching-zh-CN") });

    expect(result.status).toBe("approved");
    expect(captured).toHaveLength(2);
    for (const input of captured) {
      expect(JSON.stringify(input)).not.toContain('"words"');
      expect(input.draft.contentHash).toBe(candidate.contentHash);
      for (const segment of input.draft.segments) expect(segment).not.toHaveProperty("words");
    }
  });

  it("strips word timings from the MiniMax review request body", async () => {
    let requestBody = "";
    const fetchImplementation: typeof fetch = async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ decision: "approved", notes: "ok" }) }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const provider = new MiniMaxMediaReviewProvider("content-es-ES", { apiKey: "test-key", fetchImplementation });
    const input = reviewInput();

    await expect(provider.review(input)).resolves.toMatchObject({ decision: "approved", inputHash: mediaReviewInputHash(input) });
    expect(requestBody).not.toContain('"words"');
    expect(requestBody).toContain(input.contentHash);
  });
});

describe("media revision word projection", () => {
  it("sends a word-free draft to the revision provider but keeps provider words in the revised candidate", async () => {
    const candidate = makeCandidate();
    const reviews = [{
      id: "review-1",
      candidateId: candidate.id,
      dimension: "teaching-zh-CN" as const,
      status: "changes_requested" as const,
      reviewerReference: "dsh-ai-owner-authorized-review",
      candidateRevision: candidate.revision,
      notes: "Ajustar el resumen.",
    }];
    const requestCandidateReprocessing = vi.fn(async (input: Parameters<ContentWorkflowRepository["requestCandidateReprocessing"]>[0]) => ({
      ...candidate,
      revision: candidate.revision + 1,
      metadata: input.metadata ?? candidate.metadata,
      contentHash: input.contentHash ?? candidate.contentHash,
    }));
    const repository = {
      getCandidateReview: vi.fn(async () => ({ candidate, source: {}, artifacts: [], attempts: [], reviews })),
      requestCandidateReprocessing,
      recordProcessingAttempt: vi.fn(async () => undefined),
    } as unknown as ContentWorkflowRepository;
    let capturedInput: MediaRevisionInput | null = null;
    const revisionProvider = {
      async revise(input: MediaRevisionInput) {
        capturedInput = input;
        return { summary: "Una charla breve y clara sobre el mercado.", changeReason: "Ajustar el resumen." };
      },
    };

    await reviseMediaCandidateAfterReview(repository, {
      candidateId: candidate.id,
      revisionProvider,
      now: () => new Date("2026-10-14T12:00:00.000Z"),
      makeGenerationId: () => "generation-2",
    });

    expect(capturedInput).not.toBeNull();
    expect(JSON.stringify(capturedInput)).not.toContain('"words"');
    const requested = requestCandidateReprocessing.mock.calls[0]?.[0];
    expect(requested).toBeDefined();
    const nextDraft = podcastCandidateDraftSchema.parse(requested!.metadata?.podcastDraft);
    expect(nextDraft.segments[0]?.words).toHaveLength(3);
    expect(nextDraft.segments[0]?.words?.[0]?.text).toBe("Hola");
    expect(nextDraft.contentHash).toBe(calculatePodcastCandidateContentHash(nextDraft));
    expect(nextDraft.contentHash).not.toBe(candidate.contentHash);
  });

  it("strips word timings from the MiniMax revision request body", async () => {
    let requestBody = "";
    const fetchImplementation: typeof fetch = async (_input, init) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ summary: "Una explicación breve.", changeReason: "Repair." }) }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const provider = new MiniMaxMediaRevisionProvider({ apiKey: "test-key", fetchImplementation });

    await expect(provider.revise({
      candidateId: "candidate-words-review",
      candidateRevision: 2,
      contentType: "podcast",
      draft: makeDraft(),
      feedback: [{ dimension: "teaching-zh-CN", notes: "Ajustar el resumen." }],
    })).resolves.toMatchObject({ summary: "Una explicación breve." });
    expect(requestBody).not.toContain('"words"');
  });
});
