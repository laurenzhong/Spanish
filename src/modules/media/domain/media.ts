import type { MediaProgress } from "./media-progress";
import { validWordTimings, type MediaWordTiming } from "./word-timeline";

export type MediaKind = "video" | "podcast";
export type MediaCefr = "A2" | "B1" | null;
export type MediaContentStatus = "draft" | "review" | "approved" | "published" | "archived";
export type MediaArtworkSource = "youtube" | "podcast-feed" | "fallback";

export type MediaArtwork = Readonly<{
  url: string;
  alt: string;
  source: MediaArtworkSource;
  width: number | null;
  height: number | null;
  expiresAt: string | null;
}>;

export type RawMediaArtwork = Readonly<{
  url: string;
  alt: string;
  source: MediaArtworkSource;
  width: number | null;
  height: number | null;
  expiresAt: Date | null;
}>;

export type RawMediaProjection = Readonly<{
  stableKey: string;
  version: number;
  kind: MediaKind;
  title: string;
  summary: string;
  sourceName: string;
  language: string;
  region: string | null;
  cefr: MediaCefr;
  topics: readonly string[];
  durationMs: number;
  publishedAt: Date | null;
  curatedAt: Date;
  contentHash: string;
  status: MediaContentStatus;
  copyrightStatus: "unverified" | "cleared" | "restricted";
  playable: boolean;
  artwork?: RawMediaArtwork | null;
  progress?: MediaProgress | null;
}>;

export type MediaCard = Readonly<{
  id: string;
  stableKey: string;
  version: number;
  kind: MediaKind;
  title: string;
  summary: string;
  sourceName: string;
  language: string;
  region: string | null;
  cefr: MediaCefr;
  topics: readonly string[];
  durationMs: number;
  publishedAt: string | null;
  curatedAt: string;
  contentHash: string;
  artwork?: MediaArtwork | null;
  progress: MediaProgress | null;
}>;

export type MediaSegment = Readonly<{
  words?: readonly MediaWordTiming[];
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  sourceText: string;
  translation: string | null;
  speaker: string | null;
  reviewStatus: "pending" | "approved" | "changes_requested";
}>;

export type MediaPlaybackAsset = Readonly<{
  kind: "official_embed" | "audio" | "video";
  url: string;
  expiresAt: Date | null;
}>;

export type MediaPlayback = Readonly<{
  media: MediaCard;
  asset: Readonly<{
    kind: MediaPlaybackAsset["kind"];
    url: string;
    expiresAt: string | null;
  }>;
  segments: readonly Omit<MediaSegment, "reviewStatus">[];
}>;

export class MediaUnavailableError extends Error {
  readonly code = "MEDIA_NOT_AVAILABLE" as const;

  constructor(message = "MEDIA_NOT_AVAILABLE") {
    super(message);
    this.name = "MediaUnavailableError";
  }
}

export function mediaDocumentId(stableKey: string, version: number): string {
  return `${stableKey}@${version}`;
}

export function parseMediaDocumentId(value: string): Readonly<{ stableKey: string; version: number }> {
  const match = /^([a-z0-9][a-z0-9._-]{2,199})@([1-9][0-9]*)$/u.exec(value);
  if (!match) throw new Error("MEDIA_ID_INVALID");
  return { stableKey: match[1], version: Number(match[2]) };
}

function projectArtwork(raw: RawMediaArtwork | null, now: Date): MediaArtwork | null {
  if (!raw || !["youtube", "podcast-feed", "fallback"].includes(raw.source)) return null;
  if (raw.alt.trim().length < 1 || raw.alt.trim().length > 300) return null;
  let url: URL;
  try {
    url = new URL(raw.url);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const hasWidth = raw.width !== null;
  const hasHeight = raw.height !== null;
  if (hasWidth !== hasHeight || (hasWidth && (!Number.isInteger(raw.width) || raw.width! <= 0 || !Number.isInteger(raw.height) || raw.height! <= 0))) return null;
  if (raw.expiresAt && raw.expiresAt.getTime() <= now.getTime()) return null;
  return {
    url: url.toString(),
    alt: raw.alt.trim(),
    source: raw.source,
    width: raw.width,
    height: raw.height,
    expiresAt: raw.expiresAt?.toISOString() ?? null,
  };
}

export function projectMediaCard(raw: RawMediaProjection, now = new Date()): MediaCard | null {
  if (raw.status !== "published" || raw.copyrightStatus !== "cleared" || !raw.playable) return null;
  if (!Number.isInteger(raw.version) || raw.version < 1) return null;
  if (!Number.isInteger(raw.durationMs) || raw.durationMs <= 0) return null;
  return {
    id: mediaDocumentId(raw.stableKey, raw.version),
    stableKey: raw.stableKey,
    version: raw.version,
    kind: raw.kind,
    title: raw.title,
    summary: raw.summary,
    sourceName: raw.sourceName,
    language: raw.language,
    region: raw.region,
    cefr: raw.cefr,
    topics: [...raw.topics],
    durationMs: raw.durationMs,
    publishedAt: raw.publishedAt?.toISOString() ?? null,
    curatedAt: raw.curatedAt.toISOString(),
    contentHash: raw.contentHash,
    artwork: projectArtwork(raw.artwork ?? null, now),
    progress: raw.progress ?? null,
  };
}

export function projectMediaPlayback(
  raw: Readonly<{
    card: MediaCard;
    asset: MediaPlaybackAsset;
    segments: readonly MediaSegment[];
  }>,
  now = new Date(),
): MediaPlayback {
  let url: URL;
  try {
    url = new URL(raw.asset.url);
  } catch {
    throw new MediaUnavailableError();
  }
  if (url.protocol !== "https:") throw new MediaUnavailableError();
  if (raw.asset.expiresAt && raw.asset.expiresAt.getTime() <= now.getTime()) {
    throw new MediaUnavailableError();
  }
  return {
    media: raw.card,
    asset: {
      kind: raw.asset.kind,
      url: url.toString(),
      expiresAt: raw.asset.expiresAt?.toISOString() ?? null,
    },
    segments: raw.segments
      .filter((segment) => segment.reviewStatus === "approved")
      .map((segment) => ({
        id: segment.id,
        index: segment.index,
        startMs: segment.startMs,
        endMs: segment.endMs,
        sourceText: segment.sourceText,
        translation: segment.translation,
        speaker: segment.speaker,
        words: validWordTimings(segment),
      })),
  };
}
