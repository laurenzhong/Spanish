import { validateSegmentTimeline, type DraftMediaSegment } from "@/src/modules/media/domain";

export type MediaSegmentationInput = Readonly<{
  text: string;
  durationMs: number;
  confidence: number | null;
  sourceKind?: "asr";
  maxSegments?: number;
}>;

export class MediaSegmentationError extends Error {
  readonly code = "MEDIA_SEGMENTATION_FAILED" as const;

  constructor(message: string) {
    super(message);
    this.name = "MediaSegmentationError";
  }
}

function sentenceParts(text: string): string[] {
  return text
    .replace(/\s+/gu, " ")
    .trim()
    .split(/(?<=[.!?…。！？])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Convert a provider's untimed transcript into a deterministic, reviewable draft timeline. */
export function segmentMediaTranscript(input: MediaSegmentationInput): DraftMediaSegment[] {
  if (!Number.isInteger(input.durationMs) || input.durationMs <= 0) throw new MediaSegmentationError("Media duration must be a positive integer.");
  const parts = sentenceParts(input.text);
  const maxSegments = input.maxSegments ?? 500;
  if (!Number.isInteger(maxSegments) || maxSegments < 1 || maxSegments > 500) throw new MediaSegmentationError("The segment limit is invalid.");
  if (parts.length === 0) throw new MediaSegmentationError("The transcript is empty.");
  if (parts.length > maxSegments) throw new MediaSegmentationError("The transcript contains too many sentences.");
  if (parts.length > input.durationMs) throw new MediaSegmentationError("The media duration is too short for the generated cue count.");

  const totalWeight = parts.reduce((sum, part) => sum + Math.max(part.length, 1), 0);
  let cursor = 0;
  const segments = parts.map((sourceText, index) => {
    const remaining = input.durationMs - cursor;
    const remainingParts = parts.length - index;
    const proportional = index === parts.length - 1
      ? remaining
      : Math.max(1, Math.round(input.durationMs * sourceText.length / totalWeight));
    const endMs = index === parts.length - 1
      ? input.durationMs
      : Math.min(input.durationMs - (remainingParts - 1), cursor + proportional);
    const segment: DraftMediaSegment = {
      index,
      startMs: cursor,
      endMs,
      sourceText,
      translation: null,
      speaker: null,
      confidence: input.confidence,
      sourceKind: input.sourceKind ?? "asr",
    };
    cursor = endMs;
    return segment;
  });
  try {
    validateSegmentTimeline(segments, input.durationMs);
  } catch (error) {
    throw new MediaSegmentationError(error instanceof Error ? error.message : "The generated timeline is invalid.");
  }
  return segments;
}
