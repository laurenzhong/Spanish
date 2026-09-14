import {
  evaluateMediaAsrEligibility,
  getMediaProcessingReviewResult,
  MediaProcessingError,
  segmentMediaTranscript,
  type MediaAsrPolicy,
  type MediaProcessingReviewResult,
  type MediaTranscriptSegment,
} from "../domain";
import { consumeMediaTranscription, type MediaTranscriptionInput, type MediaTranscriptionProvider } from "../providers/media-transcription";
import type { MediaTranslationProvider } from "../providers/media-translation";

export type TemporaryMediaArtifact = Readonly<{ id: string; path: string; byteSize: number }>;

export interface MediaProcessingArtifactStore {
  acquire(input: Readonly<{ candidateId: string; sourceUrl: string; maxBytes: number }>, options?: Readonly<{ signal?: AbortSignal }>): Promise<TemporaryMediaArtifact>;
  delete(artifactId: string): Promise<void>;
  /** Persist a retryable cleanup record when the storage delete itself fails. */
  recordDeletionFailure?(input: Readonly<{ artifactId: string; error: string; occurredAt: Date }>): Promise<void>;
}

export type ProcessMediaTranscriptInput = Readonly<{
  candidateId: string;
  mediaType: "video" | "podcast";
  sourceUrl: string;
  sourceEnabled: boolean;
  rightsStatus: "unknown" | "verified" | "restricted" | "revoked";
  language: string;
  durationMs: number;
  assetBytes: number;
  captionStatus: "unavailable" | "platform_manual" | "platform_auto" | "asr";
  existingSegments: readonly MediaTranscriptSegment[];
  estimatedCostMicros: number;
}>;

export type ProcessMediaTranscriptResult = Readonly<{
  segments: readonly MediaTranscriptSegment[];
  review: MediaProcessingReviewResult;
  provider: Readonly<{ requestId: string | null; modelVersion: string; estimatedCostMicros: number }> | null;
  artifactDeleted: boolean;
}>;

export async function processMediaTranscript(options: Readonly<{
  input: ProcessMediaTranscriptInput;
  policy: MediaAsrPolicy;
  transcriptionProvider: MediaTranscriptionProvider;
  translationProvider?: MediaTranslationProvider;
  artifactStore: MediaProcessingArtifactStore;
  signal?: AbortSignal;
  timeoutMs?: number;
}>): Promise<ProcessMediaTranscriptResult> {
  const { input, policy, signal } = options;
  if (input.captionStatus !== "unavailable" && input.existingSegments.length > 0) {
    return { segments: input.existingSegments, review: getMediaProcessingReviewResult(input.existingSegments, { captionStatus: input.captionStatus, minimumConfidence: policy.minimumConfidence }), provider: null, artifactDeleted: true };
  }
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new RangeError("timeoutMs must be a positive safe integer.");
  }
  const eligibility = evaluateMediaAsrEligibility({
    sourceEnabled: input.sourceEnabled,
    rightsStatus: input.rightsStatus,
    language: input.language,
    durationMs: input.durationMs,
    assetBytes: input.assetBytes,
    estimatedCostMicros: input.estimatedCostMicros,
    captionStatus: input.captionStatus,
    segmentCount: input.existingSegments.length,
  }, policy);
  if (!eligibility.allowed) {
    throw new MediaProcessingError(eligibility.reason === "budget" ? "MEDIA_ASR_BUDGET_EXCEEDED" : "MEDIA_ASR_NOT_ELIGIBLE", `Media ASR is not eligible: ${eligibility.reason}.`);
  }
  if (signal?.aborted) throw new MediaProcessingError("MEDIA_PROCESSING_CANCELLED", "Media processing was cancelled.");
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let processingSignal = signal;
  let removeExternalAbortListener: () => void = () => undefined;
  if (options.timeoutMs !== undefined) {
    const controller = new AbortController();
    processingSignal = controller.signal;
    const onExternalAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener("abort", onExternalAbort, { once: true });
      removeExternalAbortListener = () => signal.removeEventListener("abort", onExternalAbort);
    }
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
  }

  let artifact: TemporaryMediaArtifact | null = null;
  let output: Omit<ProcessMediaTranscriptResult, "artifactDeleted"> | null = null;
  try {
    artifact = await options.artifactStore.acquire({ candidateId: input.candidateId, sourceUrl: input.sourceUrl, maxBytes: policy.maxAssetBytes }, { signal: processingSignal });
    const transcriptionInput: MediaTranscriptionInput = { candidateId: input.candidateId, mediaType: input.mediaType, language: "es", durationMs: input.durationMs, assetBytes: artifact.byteSize, assetPath: artifact.path };
    const transcription = await consumeMediaTranscription(options.transcriptionProvider.transcribe(transcriptionInput, { signal: processingSignal }), { signal: processingSignal });
    if (!Number.isSafeInteger(transcription.estimatedCostMicros) || transcription.estimatedCostMicros < 0 || transcription.estimatedCostMicros > policy.maxEstimatedCostMicros) {
      throw new MediaProcessingError("MEDIA_ASR_BUDGET_EXCEEDED", "Media ASR provider cost exceeded the hard budget.");
    }
    if (transcription.estimatedCostMicros > policy.maxEstimatedCostMicros) {
      throw new MediaProcessingError("MEDIA_ASR_BUDGET_EXCEEDED", "Media transcription exceeded the configured hard budget.");
    }
    let segments = segmentMediaTranscript(transcription.segments, { durationMs: input.durationMs, minimumConfidence: policy.minimumConfidence });
    if (options.translationProvider) {
      const translated: MediaTranscriptSegment[] = [];
      for (const segment of segments) {
        try {
          const result = await options.translationProvider.translate({ index: segment.index, sourceText: segment.sourceText }, { signal: processingSignal });
          translated.push({ ...segment, translation: result.text });
        } catch (error) {
          if (error instanceof MediaProcessingError && error.code === "MEDIA_PROCESSING_CANCELLED") throw error;
          translated.push(segment);
        }
      }
      segments = translated;
    }
    output = {
      segments,
      review: getMediaProcessingReviewResult(segments, { captionStatus: input.captionStatus, minimumConfidence: policy.minimumConfidence }),
      provider: { requestId: transcription.providerRequestId, modelVersion: transcription.modelVersion, estimatedCostMicros: transcription.estimatedCostMicros },
    };
  } catch (error) {
    if (timedOut) throw new MediaProcessingError("MEDIA_PROCESSING_TIMED_OUT", "Media processing timed out.", true);
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    removeExternalAbortListener();
    if (artifact) {
      try {
        await options.artifactStore.delete(artifact.id);
      } catch (error) {
        try {
          await options.artifactStore.recordDeletionFailure?.({
            artifactId: artifact.id,
            error: error instanceof Error ? error.message : "unknown storage error",
            occurredAt: new Date(),
          });
        } catch {
          // The cleanup error remains the stable public failure; the retry record is best effort.
        }
        throw new MediaProcessingError("MEDIA_CLEANUP_FAILED", "Temporary media could not be deleted.", true);
      }
    }
  }
  if (!output) throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "Media processing did not produce a result.");
  return { ...output, artifactDeleted: true };
}
