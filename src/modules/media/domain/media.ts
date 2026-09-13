import type { MediaProgress } from "./media-progress";

export type MediaKind = "video" | "podcast";
export type MediaCefr = "A2" | "B1" | null;
export type MediaContentStatus = "draft" | "review" | "approved" | "published" | "archived";

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
  progress: MediaProgress | null;
}>;

export type MediaSegment = Readonly<{
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

export function projectMediaCard(raw: RawMediaProjection): MediaCard | null {
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
      .slice(0, 500)
      .map((segment) => ({
        id: segment.id,
        index: segment.index,
        startMs: segment.startMs,
        endMs: segment.endMs,
        sourceText: segment.sourceText,
        translation: segment.translation,
        speaker: segment.speaker,
      })),
  };
}
