import type { CandidateStatus } from "@/src/modules/content-acquisition/domain";

export const mediaProcessingErrorCodes = [
  "MEDIA_ASR_NOT_ELIGIBLE",
  "MEDIA_ASR_BUDGET_EXCEEDED",
  "MEDIA_TRANSCRIPTION_FAILED",
  "MEDIA_TRANSCRIPTION_INCOMPLETE",
  "MEDIA_PROCESSING_CANCELLED",
  "MEDIA_PROCESSING_TIMED_OUT",
  "MEDIA_CLEANUP_FAILED",
] as const;

export type MediaProcessingErrorCode = (typeof mediaProcessingErrorCodes)[number];

export class MediaProcessingError extends Error {
  readonly code: MediaProcessingErrorCode;
  readonly retryable: boolean;

  constructor(code: MediaProcessingErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "MediaProcessingError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type MediaCaptionSource = "platform_manual" | "platform_auto" | "asr";

/**
 * Explicit small DTO for provider word timestamps. It intentionally mirrors
 * the media module's playback timings without importing that module, so the
 * processing module stays independent from media domain code.
 */
export type MediaTranscriptWordTiming = Readonly<{
  startMs: number;
  endMs: number;
  startOffset: number;
  endOffset: number;
  /** Exact provider lexical token when available. */
  text?: string;
}>;

export type MediaTranscriptSegment = Readonly<{
  index: number;
  startMs: number;
  endMs: number;
  sourceText: string;
  translation: string | null;
  speaker: string | null;
  confidence: number | null;
  sourceKind: MediaCaptionSource;
  words?: readonly MediaTranscriptWordTiming[];
}>;

export type MediaAsrPolicy = Readonly<{
  maxDurationMs: number;
  maxAssetBytes: number;
  maxEstimatedCostMicros: number;
  minimumConfidence: number;
}>;

export type MediaAsrEligibilityInput = Readonly<{
  sourceEnabled: boolean;
  rightsStatus: "unknown" | "verified" | "restricted" | "revoked";
  language: string;
  durationMs: number;
  assetBytes: number;
  estimatedCostMicros: number;
  captionStatus: "unavailable" | "platform_manual" | "platform_auto" | "asr";
  segmentCount: number;
}>;

export type MediaAsrEligibility =
  | Readonly<{ allowed: true; reason: "asr-required" }>
  | Readonly<{ allowed: false; reason: "captions-present" | "source-disabled" | "rights-required" | "unsupported-language" | "duration" | "asset-size" | "budget" }>;

export function evaluateMediaAsrEligibility(
  input: MediaAsrEligibilityInput,
  policy: MediaAsrPolicy,
): MediaAsrEligibility {
  const integerFields = {
    durationMs: input.durationMs,
    assetBytes: input.assetBytes,
    estimatedCostMicros: input.estimatedCostMicros,
    segmentCount: input.segmentCount,
    maxDurationMs: policy.maxDurationMs,
    maxAssetBytes: policy.maxAssetBytes,
    maxEstimatedCostMicros: policy.maxEstimatedCostMicros,
  };
  for (const [field, value] of Object.entries(integerFields)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
  if (policy.minimumConfidence < 0 || policy.minimumConfidence > 1) throw new RangeError("minimumConfidence must be between 0 and 1.");
  if (input.captionStatus !== "unavailable" || input.segmentCount > 0) return { allowed: false, reason: "captions-present" };
  if (!input.sourceEnabled) return { allowed: false, reason: "source-disabled" };
  if (input.rightsStatus !== "verified") return { allowed: false, reason: "rights-required" };
  if (input.language !== "es") return { allowed: false, reason: "unsupported-language" };
  if (input.durationMs > policy.maxDurationMs) return { allowed: false, reason: "duration" };
  if (input.assetBytes > policy.maxAssetBytes) return { allowed: false, reason: "asset-size" };
  if (input.estimatedCostMicros > policy.maxEstimatedCostMicros) return { allowed: false, reason: "budget" };
  return { allowed: true, reason: "asr-required" };
}

export type RawTranscriptSegment = Readonly<{
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
  speaker?: string | null;
  /** Provider word timestamps relative to `text` (before trimming). */
  words?: readonly MediaTranscriptWordTiming[];
}>;

function normalizeTranscriptWordTimings(
  words: readonly MediaTranscriptWordTiming[] | undefined,
  segment: Readonly<{ startMs: number; endMs: number; sourceText: string }>,
): readonly MediaTranscriptWordTiming[] | undefined {
  if (words === undefined || words === null) return undefined;
  if (!Array.isArray(words)) throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "The transcript word timeline is invalid.");
  if (words.length === 0) return undefined;
  const normalized: MediaTranscriptWordTiming[] = [];
  let previousTime = segment.startMs;
  let previousOffset = 0;
  for (const word of words) {
    if (!word || typeof word !== "object"
      || !Number.isInteger(word.startMs) || !Number.isInteger(word.endMs)
      || !Number.isInteger(word.startOffset) || !Number.isInteger(word.endOffset)
      || word.startMs < previousTime || word.endMs <= word.startMs || word.endMs > segment.endMs
      || word.startOffset < previousOffset || word.endOffset <= word.startOffset || word.endOffset > segment.sourceText.length) {
      throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "The transcript word timeline is invalid.");
    }
    const slice = segment.sourceText.slice(word.startOffset, word.endOffset);
    if (!/[\p{L}\p{M}\p{N}]/u.test(slice) || (word.text !== undefined && (typeof word.text !== "string" || word.text !== slice))) {
      throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "The transcript word timeline does not match its source text.");
    }
    previousTime = word.endMs;
    previousOffset = word.endOffset;
    normalized.push({
      startMs: word.startMs,
      endMs: word.endMs,
      startOffset: word.startOffset,
      endOffset: word.endOffset,
      ...(typeof word.text === "string" ? { text: word.text } : {}),
    });
  }
  return normalized;
}

export function segmentMediaTranscript(
  rawSegments: readonly RawTranscriptSegment[],
  options: Readonly<{ durationMs: number; minimumConfidence: number }>,
): readonly MediaTranscriptSegment[] {
  if (!Number.isSafeInteger(options.durationMs) || options.durationMs <= 0) throw new RangeError("durationMs must be positive.");
  if (options.minimumConfidence < 0 || options.minimumConfidence > 1) throw new RangeError("minimumConfidence must be between 0 and 1.");
  let previousEnd = 0;
  return rawSegments.map((raw, index) => {
    if (!Number.isSafeInteger(raw.startMs) || !Number.isSafeInteger(raw.endMs) || raw.startMs < 0 || raw.endMs <= raw.startMs || raw.endMs > options.durationMs || raw.startMs < previousEnd) {
      throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "The transcript timeline is invalid.");
    }
    const sourceText = raw.text.trim();
    if (!sourceText) throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "The transcript contains an empty segment.");
    if (raw.confidence !== null && (raw.confidence < 0 || raw.confidence > 1)) throw new MediaProcessingError("MEDIA_TRANSCRIPTION_FAILED", "The transcript confidence is invalid.");
    const words = normalizeTranscriptWordTimings(raw.words, { startMs: raw.startMs, endMs: raw.endMs, sourceText });
    previousEnd = raw.endMs;
    return {
      index,
      startMs: raw.startMs,
      endMs: raw.endMs,
      sourceText,
      translation: null,
      speaker: raw.speaker ?? null,
      confidence: raw.confidence,
      sourceKind: "asr",
      ...(words ? { words } : {}),
    };
  });
}

export function hasLowConfidenceSegments(segments: readonly MediaTranscriptSegment[], minimumConfidence: number): boolean {
  if (minimumConfidence < 0 || minimumConfidence > 1) throw new RangeError("minimumConfidence must be between 0 and 1.");
  return segments.some((segment) => segment.confidence !== null && segment.confidence < minimumConfidence);
}

export type MediaProcessingReviewResult = Readonly<{
  status: "review_ready" | "blocked";
  reason: "translated" | "translation-partial" | "low-confidence" | "captions-present";
}>;

export function getMediaProcessingReviewResult(
  segments: readonly MediaTranscriptSegment[],
  input: Readonly<{ captionStatus: "unavailable" | "platform_manual" | "platform_auto" | "asr"; minimumConfidence: number }>,
): MediaProcessingReviewResult {
  if (input.captionStatus !== "unavailable" && input.captionStatus !== "asr") return { status: "review_ready", reason: "captions-present" };
  if (hasLowConfidenceSegments(segments, input.minimumConfidence)) return { status: "blocked", reason: "low-confidence" };
  return { status: "review_ready", reason: segments.some((segment) => segment.translation === null) ? "translation-partial" : "translated" };
}

export function isMediaCandidateProcessable(status: CandidateStatus): boolean {
  return status === "processing" || status === "acquiring";
}
