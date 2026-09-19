import { randomUUID } from "node:crypto";

import { evaluateMediaAsrEligibility, type ProcessingBudgetPolicy, type ProcessingBudgetUsage } from "../domain";
import type { DraftMediaSegment } from "@/src/modules/media/domain";
import type { SpeechToTextProvider } from "@/src/modules/providers/stt/transcription";
import type { TranslationProvider } from "@/src/modules/providers/translation/translation";
import { transcribeMediaAudio, type MediaTranscriptionResult, type MediaAudioChunk } from "../processors/media-transcription-processor";
import { translateMediaSegments } from "../processors/media-translation-processor";

export type MediaProcessingCandidate = Readonly<{
  id: string;
  contentType: "video" | "podcast" | "article";
  language: string;
  rightsStatus: "unknown" | "verified" | "restricted" | "revoked";
  durationMs: number;
  assetBytes: number;
  mimeType: string;
  fileName: string;
  contentHash: string | null;
  manualSegments?: readonly DraftMediaSegment[];
  automaticSegments?: readonly DraftMediaSegment[];
}>;

export type TemporaryMediaAudio = Readonly<{ bytes: Uint8Array; mimeType: string; fileName: string; contentHash: string; storageKey?: string | null; preparedChunks?: readonly MediaAudioChunk[] }>;

export type MediaAudioAssetProvider = Readonly<{
  acquire: (candidate: MediaProcessingCandidate, options?: Readonly<{ signal?: AbortSignal }>) => Promise<TemporaryMediaAudio>;
  release: (asset: TemporaryMediaAudio) => Promise<"deleted" | "delete-pending" | "failed">;
}>;

export type MediaProcessingAttempt = Readonly<{
  id: string;
  candidateId: string;
  jobType: "media-transcription";
  jobId: string;
  generationId: string;
  expectedRevision: number;
  status: "succeeded" | "failed" | "cancelled" | "timed_out";
  estimatedCostMicros: number;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date;
}>;

export type MediaProcessingResult = Readonly<{
  status: "skipped" | "succeeded";
  transcriptSource: "platform_manual" | "platform_auto" | "asr";
  segments: readonly DraftMediaSegment[];
  lowConfidence: boolean;
  translationFailedCount: number;
  estimatedCostMicros: number;
  cleanupStatus: "not-required" | "deleted" | "delete-pending" | "failed";
  attempt: MediaProcessingAttempt | null;
  provider?: string;
  modelVersion?: string;
}>;

export class MediaProcessingError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MediaProcessingError";
    this.code = code;
  }
}

export interface MediaProcessingRepository {
  findTranscriptByAudioHash?: (audioHash: string) => Promise<readonly DraftMediaSegment[] | null>;
  saveTranscriptDraft?: (input: Readonly<{ candidateId: string; audioHash: string; segments: readonly DraftMediaSegment[]; provider: string; modelVersion: string; lowConfidence: boolean }>) => Promise<void>;
  commitTranscriptDraft?: (input: Readonly<{ candidateId: string; expectedRevision: number; generationId: string; artifactId: string; artifactStorageKey: string | null; audioHash: string; byteSize: number; segments: readonly DraftMediaSegment[]; provider: string; modelVersion: string; lowConfidence: boolean; createdAt: Date }>) => Promise<void>;
  markArtifactCleanup?: (input: Readonly<{ artifactId: string; status: "deleted" | "delete-pending" | "failed"; deletedAt: Date | null }>) => Promise<void>;
  recordAttempt?: (attempt: MediaProcessingAttempt) => Promise<void>;
}

function lowConfidence(segments: readonly DraftMediaSegment[]): boolean {
  return segments.some((segment) => segment.confidence !== null && segment.confidence < 0.8);
}

function attemptFor(input: Readonly<{ candidate: MediaProcessingCandidate; generationId: string; expectedRevision: number; status: MediaProcessingAttempt["status"]; estimatedCostMicros: number; errorCode: string | null; startedAt: Date; completedAt: Date }>): MediaProcessingAttempt {
  return {
    id: randomUUID(), candidateId: input.candidate.id, jobType: "media-transcription", jobId: `media-transcription:${input.candidate.id}:${input.generationId}`,
    generationId: input.generationId, expectedRevision: input.expectedRevision, status: input.status,
    estimatedCostMicros: input.estimatedCostMicros, errorCode: input.errorCode, startedAt: input.startedAt, completedAt: input.completedAt,
  };
}

/** Process a candidate into an ASR review draft. The temporary asset is always released in finally. */
export async function processMediaCandidate(input: Readonly<{
  candidate: MediaProcessingCandidate;
  generationId?: string;
  expectedRevision?: number;
  sourceEnabled?: boolean;
  budgetPolicy: ProcessingBudgetPolicy;
  budgetUsage: ProcessingBudgetUsage;
  estimatedCostMicros: number;
  audio: MediaAudioAssetProvider;
  transcriptionProvider: SpeechToTextProvider;
  translationProvider?: TranslationProvider;
  repository?: MediaProcessingRepository;
  signal?: AbortSignal;
  now?: () => Date;
}>): Promise<MediaProcessingResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const manual = input.candidate.manualSegments?.length ? input.candidate.manualSegments : null;
  const automatic = input.candidate.automaticSegments?.length ? input.candidate.automaticSegments : null;
  if (manual) return { status: "skipped", transcriptSource: "platform_manual", segments: manual, lowConfidence: false, translationFailedCount: 0, estimatedCostMicros: 0, cleanupStatus: "not-required", attempt: null };
  if (automatic) return { status: "skipped", transcriptSource: "platform_auto", segments: automatic, lowConfidence: false, translationFailedCount: 0, estimatedCostMicros: 0, cleanupStatus: "not-required", attempt: null };

  const eligibility = evaluateMediaAsrEligibility({
    contentType: input.candidate.contentType,
    language: input.candidate.language,
    sourceEnabled: input.sourceEnabled ?? true,
    rightsStatus: input.candidate.rightsStatus,
    durationMs: input.candidate.durationMs,
    assetBytes: input.candidate.assetBytes,
    budgetPolicy: input.budgetPolicy,
    budgetUsage: input.budgetUsage,
    estimatedCostMicros: input.estimatedCostMicros,
    hasManualTranscript: false,
    hasAutomaticTranscript: false,
  });
  if (!eligibility.allowed) throw new MediaProcessingError(`MEDIA_ASR_BLOCKED_${eligibility.reason.toUpperCase()}`, `Media ASR is blocked: ${eligibility.reason}.`);

  let asset: TemporaryMediaAudio | null = null;
  let processingError: unknown = null;
  let totalCost = 0;
  let result: MediaProcessingResult | null = null;
  let attempt: MediaProcessingAttempt | null = null;
  let artifactId: string | null = null;
  try {
    asset = await input.audio.acquire(input.candidate, { signal: input.signal });
    const cached = input.repository?.findTranscriptByAudioHash ? await input.repository.findTranscriptByAudioHash(asset.contentHash) : null;
    if (cached) {
      result = { status: "succeeded", transcriptSource: "asr", segments: cached, lowConfidence: lowConfidence(cached), translationFailedCount: 0, estimatedCostMicros: 0, cleanupStatus: "not-required", attempt: null, provider: "cached", modelVersion: "cached" };
    } else {
      const transcription: MediaTranscriptionResult = await transcribeMediaAudio({ audioBytes: asset.bytes, preparedChunks: asset.preparedChunks, durationMs: input.candidate.durationMs, mimeType: asset.mimeType, fileName: asset.fileName, languageTag: input.candidate.language, provider: input.transcriptionProvider, signal: input.signal });
      totalCost += transcription.estimatedCostMicros;
      let segments = transcription.segments;
      let translationFailedCount = 0;
      if (input.translationProvider) {
        const translated = await translateMediaSegments({ segments, provider: input.translationProvider, signal: input.signal });
        segments = translated.segments;
        translationFailedCount = translated.failedCount;
        totalCost += translated.estimatedCostMicros;
      }
      const isLowConfidence = lowConfidence(segments);
      artifactId = randomUUID();
      if (input.repository?.commitTranscriptDraft) {
        await input.repository.commitTranscriptDraft({
          candidateId: input.candidate.id,
          expectedRevision: input.expectedRevision ?? 1,
          generationId: input.generationId ?? "generation-1",
          artifactId,
          artifactStorageKey: asset.storageKey ?? null,
          audioHash: asset.contentHash,
          byteSize: asset.bytes.byteLength,
          segments,
          provider: transcription.provider,
          modelVersion: transcription.modelVersion,
          lowConfidence: isLowConfidence,
          createdAt: now(),
        });
      } else {
        await input.repository?.saveTranscriptDraft?.({ candidateId: input.candidate.id, audioHash: asset.contentHash, segments, provider: transcription.provider, modelVersion: transcription.modelVersion, lowConfidence: isLowConfidence });
      }
      result = { status: "succeeded", transcriptSource: "asr", segments, lowConfidence: isLowConfidence, translationFailedCount, estimatedCostMicros: totalCost, cleanupStatus: "not-required", attempt: null, provider: transcription.provider, modelVersion: transcription.modelVersion };
    }
  } catch (error) {
    processingError = error;
    if (error instanceof MediaProcessingError) throw error;
    const providerCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
    throw new MediaProcessingError(providerCode ? `MEDIA_PROCESSING_${providerCode.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}` : "MEDIA_PROCESSING_FAILED", "Media processing failed.", { cause: error });
  } finally {
    if (asset) {
      let cleanupStatus: "deleted" | "delete-pending" | "failed" = "failed";
      try { cleanupStatus = await input.audio.release(asset); } catch { cleanupStatus = "failed"; }
      if (artifactId && input.repository?.markArtifactCleanup) {
        try {
          await input.repository.markArtifactCleanup({ artifactId, status: cleanupStatus, deletedAt: cleanupStatus === "deleted" ? now() : null });
        } catch {
          cleanupStatus = "failed";
        }
      }
      if (result) result = { ...result, cleanupStatus };
    }
    if (input.repository?.recordAttempt) {
      const terminalStatus: MediaProcessingAttempt["status"] = input.signal?.aborted ? "cancelled" : processingError ? "failed" : "succeeded";
      attempt = attemptFor({ candidate: input.candidate, generationId: input.generationId ?? "generation-1", expectedRevision: input.expectedRevision ?? 1, status: terminalStatus, estimatedCostMicros: totalCost, errorCode: processingError instanceof MediaProcessingError ? processingError.code : null, startedAt, completedAt: now() });
      await input.repository.recordAttempt(attempt);
    }
  }
  if (!result) throw new MediaProcessingError("MEDIA_PROCESSING_FAILED", "Media processing did not produce a result.");
  return { ...result, attempt };
}
