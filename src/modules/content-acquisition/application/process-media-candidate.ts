import { randomUUID } from "node:crypto";

import { isMediaCandidateProcessable, MediaProcessingError, processMediaTranscript, type MediaAsrPolicy, type MediaProcessingArtifactStore } from "@/src/modules/media-processing";
import type { MediaTranscriptionProvider } from "@/src/modules/media-processing/providers/media-transcription";
import type { MediaTranslationProvider } from "@/src/modules/media-processing/providers/media-translation";
import { calculatePodcastCandidateContentHash, podcastCandidateDraftSchema } from "../normalizers/podcast-candidate";
import { calculateVideoCandidateContentHash, videoCandidateDraftSchema } from "../normalizers/youtube-candidate";
import { processCandidate } from "./process-candidate";
import type { ContentAcquisitionRepository, ContentCandidateRecord, ContentSourceRecord } from "../repositories";

export type ProcessMediaCandidateDependencies = Readonly<{
  transcriptionProvider: MediaTranscriptionProvider;
  translationProvider?: MediaTranslationProvider;
  artifactStore: MediaProcessingArtifactStore;
  policy: MediaAsrPolicy;
  makeAttemptId?: () => string;
  now?: () => Date;
  resolveArtifactStore?: (input: Readonly<{ candidate: ContentCandidateRecord; source: ContentSourceRecord }>) => MediaProcessingArtifactStore;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export class MediaCandidateProcessingError extends Error {
  readonly code = "CONTENT_PROCESSING_FAILED" as const;

  constructor(message: string) {
    super(`Media candidate processing failed: ${message}`);
    this.name = "MediaCandidateProcessingError";
  }
}

export async function processMediaCandidate(
  repository: ContentAcquisitionRepository,
  candidateId: string,
  dependencies: ProcessMediaCandidateDependencies,
): Promise<ContentCandidateRecord> {
  const candidate = await repository.findCandidateById(candidateId);
  if (!candidate || (candidate.contentType !== "video" && candidate.contentType !== "podcast")) throw new MediaCandidateProcessingError("candidate was not found or is not media.");
  if (!isMediaCandidateProcessable(candidate.status)) throw new MediaCandidateProcessingError(`candidate cannot be processed from ${candidate.status}.`);
  const source = await (repository.findSourceById?.(candidate.sourceId) ?? repository.findSourceByStableKey(candidate.sourceId));
  if (!source) throw new MediaCandidateProcessingError("source was not found.");
  const podcast = candidate.contentType === "podcast" ? parsePodcast(candidate.metadata.podcastDraft) : null;
  const video = candidate.contentType === "video" ? parseVideo(candidate.metadata.videoDraft) : null;
  const draft = podcast?.draft ?? video!.draft;
  const captionStatus = podcast?.captionStatus ?? video!.captionStatus;
  const sourceUrl = podcast ? podcast.draft.enclosureUrl : String((candidate.metadata as Record<string, unknown>).processingAssetUrl ?? video?.draft.canonicalUrl ?? "");
  if (!sourceUrl) throw new MediaCandidateProcessingError("no downloadable processing asset is available.");
  const startedAt = (dependencies.now ?? (() => new Date()))();
  const revalidate = async () => {
    const [current, currentSource] = await Promise.all([
      repository.findCandidateById(candidate.id),
      repository.findSourceById?.(candidate.sourceId) ?? repository.findSourceByStableKey(candidate.sourceId),
    ]);
    if (!current || current.revision !== candidate.revision || current.generationId !== candidate.generationId || current.sourceId !== candidate.sourceId || !isMediaCandidateProcessable(current.status)) {
      throw new MediaProcessingError("MEDIA_PROCESSING_CANCELLED", "Media candidate generation is no longer current.");
    }
    if (!currentSource || currentSource.id !== candidate.sourceId || currentSource.revision !== source.revision || current.rightsStatus !== "verified") {
      throw new MediaProcessingError("MEDIA_PROCESSING_NOT_AUTHORIZED", "Media candidate or source authorization is no longer current.");
    }
    return { sourceEnabled: currentSource.enabled, rightsStatus: currentSource.rightsStatus, processingAuthorization: currentSource.rightsPolicy?.mediaProcessing };
  };
  let result;
  try {
    result = await processMediaTranscript({
      input: {
        candidateId: candidate.id,
        mediaType: candidate.contentType,
        sourceUrl,
        sourceEnabled: source.enabled,
        rightsStatus: source.rightsStatus,
        processingAuthorization: source.rightsPolicy?.mediaProcessing,
        // Candidates feed the general learning library, not a private notes store.
        processingAudience: "shared-learning",
        language: candidate.language,
        durationMs: draft.durationMs,
        assetBytes: podcast ? podcast.draft.enclosureByteSize : Number((candidate.metadata as Record<string, unknown>).processingAssetBytes ?? 0),
        captionStatus,
        existingSegments: draft.segments,
        estimatedCostMicros: Number((candidate.metadata as Record<string, unknown>).estimatedAsrCostMicros ?? 0),
      },
      policy: dependencies.policy,
      transcriptionProvider: dependencies.transcriptionProvider,
      translationProvider: dependencies.translationProvider,
      artifactStore: dependencies.resolveArtifactStore
        ? dependencies.resolveArtifactStore({ candidate, source: source })
        : dependencies.artifactStore,
      signal: dependencies.signal,
      timeoutMs: dependencies.timeoutMs ?? 15 * 60 * 1000,
      now: dependencies.now,
      revalidate,
    });
  } catch (error) {
    const completedAt = (dependencies.now ?? (() => new Date()))();
    await recordAttempt(repository, {
      id: (dependencies.makeAttemptId ?? randomUUID)(),
      candidateId: candidate.id,
      jobType: "media-asr-translation",
      jobId: `media-asr-translation:${candidate.id}:${candidate.generationId}`,
      generationId: candidate.generationId,
      expectedRevision: candidate.revision,
      status: error instanceof MediaProcessingError && error.code === "MEDIA_PROCESSING_CANCELLED" ? "cancelled" : error instanceof MediaProcessingError && error.code === "MEDIA_PROCESSING_TIMED_OUT" ? "timed_out" : "failed",
      estimatedCostMicros: 0,
      startedAt,
      completedAt,
      errorCode: error instanceof MediaProcessingError ? error.code : "MEDIA_TRANSCRIPTION_FAILED",
    });
    // Persist a retryable terminal state so the next scheduled run can use
    // the failed -> retry transition instead of leaving the candidate stuck.
    try {
      await processCandidate(repository, {
        candidateId: candidate.id,
        event: { type: "fail", expectedRevision: candidate.revision, generationId: candidate.generationId },
        now: dependencies.now,
      });
    } catch {
      // A concurrent worker may have advanced the candidate already.
    }
    throw error;
  }
  const nextMetadata = { ...candidate.metadata } as Record<string, unknown>;
  if (podcast) {
    const nextDraft = { ...podcast.draft, transcriptStatus: result.provider ? "asr" as const : podcast.draft.transcriptStatus, transcriptUrl: result.provider ? null : podcast.draft.transcriptUrl, segments: [...result.segments] };
    // Hash the schema-normalized draft: zod reorders optional keys (notably
    // `words` comes first), and the immutable content hash must equal what a
    // later schema parse recomputes before review and publication.
    const normalizedDraft = podcastCandidateDraftSchema.parse({ ...nextDraft, contentHash: "0".repeat(64) });
    nextMetadata.podcastDraft = { ...normalizedDraft, contentHash: calculatePodcastCandidateContentHash(normalizedDraft) };
  } else {
    const nextDraft = { ...video!.draft, captionStatus: video!.draft.captionStatus === "unavailable" ? "asr" as const : video!.draft.captionStatus, segments: [...result.segments] };
    const normalizedDraft = videoCandidateDraftSchema.parse({ ...nextDraft, contentHash: "0".repeat(64) });
    nextMetadata.videoDraft = { ...normalizedDraft, contentHash: calculateVideoCandidateContentHash(normalizedDraft) };
  }
  nextMetadata.mediaProcessingReview = result.review;
  const now = (dependencies.now ?? (() => new Date()))();
  const updated = await repository.compareAndSwapCandidate({
    candidateId: candidate.id,
    expectedRevision: candidate.revision,
    expectedGenerationId: candidate.generationId,
    status: result.review.status === "review_ready" ? "review_ready" : "processing",
    generationId: candidate.generationId,
    metadata: nextMetadata,
    contentHash: candidate.contentType === "podcast"
      ? String((nextMetadata.podcastDraft as Record<string, unknown>).contentHash)
      : String((nextMetadata.videoDraft as Record<string, unknown>).contentHash),
    updatedAt: now,
  });
  await recordAttempt(repository, {
    id: (dependencies.makeAttemptId ?? randomUUID)(),
    candidateId: candidate.id,
    jobType: "media-asr-translation",
    jobId: `media-asr-translation:${candidate.id}:${candidate.generationId}`,
    generationId: candidate.generationId,
    expectedRevision: candidate.revision,
    status: result.review.status === "review_ready" ? "succeeded" : "failed",
    estimatedCostMicros: result.provider?.estimatedCostMicros ?? 0,
    startedAt,
    completedAt: now,
    errorCode: result.review.status === "review_ready" ? null : "MEDIA_ASR_LOW_CONFIDENCE",
  });
  return updated;
}

async function recordAttempt(
  repository: ContentAcquisitionRepository,
  input: Parameters<ContentAcquisitionRepository["recordProcessingAttempt"]>[0],
): Promise<void> {
  await repository.recordProcessingAttempt(input);
}

function parsePodcast(value: unknown) {
  const draft = podcastCandidateDraftSchema.safeParse(value);
  if (!draft.success) throw new MediaCandidateProcessingError("podcast draft is invalid.");
  return { draft: draft.data, captionStatus: draft.data.transcriptStatus };
}

function parseVideo(value: unknown) {
  const draft = videoCandidateDraftSchema.safeParse(value);
  if (!draft.success) throw new MediaCandidateProcessingError("video draft is invalid.");
  return { draft: draft.data, captionStatus: draft.data.captionStatus };
}
