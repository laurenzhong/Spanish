import {
  evaluateMediaAsrEligibility,
  getMediaProcessingReviewResult,
  MediaProcessingError,
  isMediaProcessingAuthorized,
  segmentMediaTranscript,
  type MediaProcessingAudience,
  type MediaProcessingOperation,
  type MediaAsrPolicy,
  type MediaProcessingReviewResult,
  type MediaTranscriptSegment,
} from "../domain";
import { consumeMediaTranscription, type MediaTranscriptionInput, type MediaTranscriptionProvider } from "../providers/media-transcription";
import type { MediaTranslationProvider } from "../providers/media-translation";
import { mediaProcessingAuthorizationSchema } from "../schemas/processing-authorization";

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
  processingAuthorization?: unknown;
  processingAudience: MediaProcessingAudience;
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
  now?: () => Date;
  /** Reload current authority; reject stale candidate generations before side effects. */
  revalidate?: () => Promise<Pick<ProcessMediaTranscriptInput, "sourceEnabled" | "rightsStatus" | "processingAuthorization">>;
}>): Promise<ProcessMediaTranscriptResult> {
  const { input, policy, signal } = options;
  if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)) {
    throw new RangeError("timeoutMs must be a positive safe integer.");
  }
  if (signal?.aborted) throw new MediaProcessingError("MEDIA_PROCESSING_CANCELLED", "Media processing was cancelled.");
  const hasCaptions = input.captionStatus !== "unavailable" && input.existingSegments.length > 0;
  const operations: MediaProcessingOperation[] = hasCaptions ? [] : ["acquire-audio", "asr"];
  if (options.translationProvider && (!hasCaptions || input.existingSegments.some((segment) => !segment.translation?.trim()))) operations.push("translate");
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

  function checkCancellation() {
    if (timedOut) throw new MediaProcessingError("MEDIA_PROCESSING_TIMED_OUT", "Media processing timed out.", true);
    if (processingSignal?.aborted) throw new MediaProcessingError("MEDIA_PROCESSING_CANCELLED", "Media processing was cancelled.");
  }
  async function checkAuthority() {
    checkCancellation();
    const authority = options.revalidate ? await options.revalidate() : input;
    checkCancellation();
    const parsed = mediaProcessingAuthorizationSchema.safeParse(authority.processingAuthorization);
    if (!isMediaProcessingAuthorized({ ...authority, authorization: parsed.success ? parsed.data : null, operations, audience: input.processingAudience, now: (options.now ?? (() => new Date()))() })) {
      throw new MediaProcessingError("MEDIA_PROCESSING_NOT_AUTHORIZED", "Media processing requires current source, operation, audience and third-party authorization.");
    }
  }
  async function translateSegments(segments: readonly MediaTranscriptSegment[]) {
    const translated: MediaTranscriptSegment[] = [];
    for (const segment of segments) {
      if (!options.translationProvider || segment.translation?.trim()) {
        translated.push(segment);
        continue;
      }
      await checkAuthority();
      let text: string | null = null;
      try {
        const result = await options.translationProvider.translate({ index: segment.index, sourceText: segment.sourceText }, { signal: processingSignal });
        text = result.text;
      } catch (error) {
        // Authorization/cancellation failures are terminal, never partial translations.
        if (error instanceof MediaProcessingError && ["MEDIA_PROCESSING_CANCELLED", "MEDIA_PROCESSING_TIMED_OUT", "MEDIA_PROCESSING_NOT_AUTHORIZED"].includes(error.code)) throw error;
      }
      // Also checks providers that ignore abort or fail after authority was withdrawn.
      await checkAuthority();
      translated.push(text === null ? segment : { ...segment, translation: text });
    }
    return translated;
  }

  let artifact: TemporaryMediaArtifact | null = null;
  let output: Omit<ProcessMediaTranscriptResult, "artifactDeleted"> | null = null;
  try {
    await checkAuthority();
    if (hasCaptions) {
      const segments = await translateSegments(input.existingSegments);
      output = { segments, review: getMediaProcessingReviewResult(segments, { captionStatus: input.captionStatus, minimumConfidence: policy.minimumConfidence }), provider: null };
    } else {
      const eligibility = evaluateMediaAsrEligibility({ ...input, captionStatus: input.existingSegments.length > 0 ? input.captionStatus : "unavailable", segmentCount: input.existingSegments.length }, policy);
      if (!eligibility.allowed) {
        throw new MediaProcessingError(eligibility.reason === "budget" ? "MEDIA_ASR_BUDGET_EXCEEDED" : "MEDIA_ASR_NOT_ELIGIBLE", `Media ASR is not eligible: ${eligibility.reason}.`);
      }
      artifact = await options.artifactStore.acquire({ candidateId: input.candidateId, sourceUrl: input.sourceUrl, maxBytes: policy.maxAssetBytes }, { signal: processingSignal });
      await checkAuthority();
      const transcriptionInput: MediaTranscriptionInput = { candidateId: input.candidateId, mediaType: input.mediaType, language: "es", durationMs: input.durationMs, assetBytes: artifact.byteSize, assetPath: artifact.path };
      const transcription = await consumeMediaTranscription(options.transcriptionProvider.transcribe(transcriptionInput, { signal: processingSignal }), { signal: processingSignal });
      await checkAuthority();
      if (!Number.isSafeInteger(transcription.estimatedCostMicros) || transcription.estimatedCostMicros < 0 || transcription.estimatedCostMicros > policy.maxEstimatedCostMicros) {
        throw new MediaProcessingError("MEDIA_ASR_BUDGET_EXCEEDED", "Media ASR provider cost exceeded the hard budget.");
      }
      if (transcription.estimatedCostMicros > policy.maxEstimatedCostMicros) {
        throw new MediaProcessingError("MEDIA_ASR_BUDGET_EXCEEDED", "Media transcription exceeded the configured hard budget.");
      }
      const segments = await translateSegments(segmentMediaTranscript(transcription.segments, { durationMs: input.durationMs, minimumConfidence: policy.minimumConfidence }));
      output = {
        segments,
        review: getMediaProcessingReviewResult(segments, { captionStatus: input.captionStatus, minimumConfidence: policy.minimumConfidence }),
        provider: { requestId: transcription.providerRequestId, modelVersion: transcription.modelVersion, estimatedCostMicros: transcription.estimatedCostMicros },
      };
    }
    await checkAuthority();
  } catch (error) {
    checkCancellation();
    throw error;
  } finally {
    try {
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
      if (output) await checkAuthority();
    } finally {
      if (timeout) clearTimeout(timeout);
      removeExternalAbortListener();
    }
  }
  if (!output) throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "Media processing did not produce a result.");
  return { ...output, artifactDeleted: true };
}
