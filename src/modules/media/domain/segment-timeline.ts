export const mediaSegmentSourceKinds = ["platform_manual", "platform_auto", "asr"] as const;

export type MediaSegmentSourceKind = (typeof mediaSegmentSourceKinds)[number];

export type DraftMediaSegment = Readonly<{
  index: number;
  startMs: number;
  endMs: number;
  sourceText: string;
  translation: string | null;
  speaker: string | null;
  confidence: number | null;
  sourceKind: MediaSegmentSourceKind;
}>;

export class MediaSegmentTimelineError extends Error {
  readonly code = "MEDIA_SEGMENT_TIMELINE_INVALID" as const;

  constructor(message: string) {
    super(`MEDIA_SEGMENT_TIMELINE_INVALID: ${message}`);
    this.name = "MediaSegmentTimelineError";
  }
}

function timestampMs(raw: string): number {
  const match = /^(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})$/u.exec(raw.trim());
  if (!match) throw new MediaSegmentTimelineError("A cue timestamp is malformed.");
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4]);
  if (minutes > 59 || seconds > 59) {
    throw new MediaSegmentTimelineError("A cue timestamp is outside the supported range.");
  }
  return (((hours * 60) + minutes) * 60 + seconds) * 1_000 + milliseconds;
}

function cleanCueText(lines: readonly string[]): string {
  return lines
    .join(" ")
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

export function validateSegmentTimeline(
  segments: readonly Readonly<{
    index: number;
    startMs: number;
    endMs: number;
    sourceText?: string;
    [key: string]: unknown;
  }>[],
  durationMs: number,
): void {
  if (!Number.isInteger(durationMs) || durationMs <= 0 || segments.length === 0 || segments.length > 500) {
    throw new MediaSegmentTimelineError("The timeline duration or segment count is invalid.");
  }
  let previousEnd = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (
      segment.index !== index
      || !Number.isInteger(segment.startMs)
      || !Number.isInteger(segment.endMs)
      || segment.startMs < 0
      || segment.endMs <= segment.startMs
      || segment.endMs > durationMs
      || (index > 0 && segment.startMs < previousEnd)
      || (segment.sourceText !== undefined && (segment.sourceText.trim().length === 0 || segment.sourceText.length > 4_000))
    ) {
      throw new MediaSegmentTimelineError(`Segment ${index} is invalid or overlaps another cue.`);
    }
    previousEnd = segment.endMs;
  }
}

export function parseWebVttSegments(
  input: string,
  options: Readonly<{ sourceKind: MediaSegmentSourceKind; durationMs?: number }>,
): DraftMediaSegment[] {
  const normalized = input.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").trim();
  if (!normalized.startsWith("WEBVTT")) {
    throw new MediaSegmentTimelineError("A WebVTT header is required.");
  }
  const blocks = normalized.split(/\n{2,}/u).slice(1);
  const segments: DraftMediaSegment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0 || lines[0] === "NOTE" || lines[0].startsWith("NOTE ")) continue;
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = /^([^\s]+)\s+-->\s+([^\s]+)(?:\s+.*)?$/u.exec(lines[timingIndex]);
    if (!timing) throw new MediaSegmentTimelineError("A cue timing line is malformed.");
    const sourceText = cleanCueText(lines.slice(timingIndex + 1));
    if (!sourceText) throw new MediaSegmentTimelineError("A cue cannot be empty.");
    segments.push({
      index: segments.length,
      startMs: timestampMs(timing[1]),
      endMs: timestampMs(timing[2]),
      sourceText,
      translation: null,
      speaker: null,
      confidence: null,
      sourceKind: options.sourceKind,
    });
  }
  const inferredDuration = segments.at(-1)?.endMs ?? 0;
  validateSegmentTimeline(segments, options.durationMs ?? inferredDuration);
  return segments;
}

export function findSegmentIndexAt(
  segments: readonly Readonly<{ index: number; startMs: number; endMs: number }>[],
  positionMs: number,
): number | null {
  if (!Number.isFinite(positionMs) || positionMs < 0) return null;
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];
    if (positionMs < segment.startMs) high = middle - 1;
    else if (positionMs >= segment.endMs) low = middle + 1;
    else return segment.index;
  }
  return null;
}
