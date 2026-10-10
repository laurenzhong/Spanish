import type { DraftMediaSegment, MediaArtwork } from "../domain";

export type AcquiredMediaReview = Readonly<{
  locale: "es-ES" | "zh-CN";
  /** Owner-authorized AI review identity; historical `codex-*` records stay valid. */
  reviewerReference: string;
  notes: string | null;
  reviewedAt: Date;
}>;

export type AcquiredVideoDraft = Readonly<{
  stableKey: string;
  platform: "youtube";
  platformVideoId: string;
  sourceChannelId: string;
  canonicalUrl: string;
  embedUrl: string;
  title: string;
  summary: string;
  sourceName: string;
  language: "es";
  region: string | null;
  cefr: "A2" | "B1";
  topics: readonly string[];
  durationMs: number;
  publicationDate: string;
  fetchedAt: string;
  license: "creative_commons" | "licensed";
  attribution: string;
  licenseEvidence: string;
  copyrightStatus: "cleared";
  artwork: MediaArtwork | null;
  captionStatus: "unavailable" | "platform_manual" | "platform_auto" | "asr";
  segments: readonly DraftMediaSegment[];
  contentHash: string;
  changeReason: string;
}>;

export type AcquiredMediaPublication = Readonly<{
  kind: "media";
  stableKey: string;
  version: number;
}>;

export type HostedVideoAsset = Readonly<{
  providerKey: "bunny-storage";
  playbackUrl: string;
  mimeType: "video/mp4";
  sha256: string;
  byteSize: number;
}>;

export interface AcquiredVideoRepository {
  publishAcquiredVideo(input: Readonly<{
    candidateId: string;
    candidateRevision: number;
    contentHash: string;
    draft: AcquiredVideoDraft;
    hostedAsset: HostedVideoAsset;
    artworkOverride?: MediaArtwork | null;
    reviews: readonly [AcquiredMediaReview, AcquiredMediaReview];
    publishedAt: Date;
  }>): Promise<AcquiredMediaPublication>;
  archiveAcquiredVideo(input: Readonly<{
    candidateId: string;
    publication: AcquiredMediaPublication;
    archivedAt: Date;
  }>): Promise<void>;
}
