import type { DraftMediaSegment } from "../domain";
import type { MediaArtwork } from "../domain";
import type { AcquiredMediaPublication, AcquiredMediaReview } from "./acquired-video-repository";

export type AcquiredPodcastDraft = Readonly<{
  stableKey: string;
  feedUrl: string;
  episodeGuid: string;
  canonicalUrl: string;
  enclosureUrl: string;
  enclosureUrlHash: string;
  enclosureMimeType: "audio/mpeg" | "audio/mp4" | "audio/aac" | "audio/ogg" | "audio/webm" | "application/ogg";
  enclosureByteSize: number;
  playbackExpiresAt: string;
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
  license: "original" | "public_domain" | "creative_commons" | "licensed";
  attribution: string;
  licenseEvidence: string;
  copyrightStatus: "cleared";
  artwork: MediaArtwork | null;
  transcriptStatus: "unavailable" | "platform_manual" | "platform_auto";
  transcriptUrl: string | null;
  segments: readonly DraftMediaSegment[];
  contentHash: string;
  changeReason: string;
}>;

export interface AcquiredPodcastRepository {
  publishAcquiredPodcast(input: Readonly<{
    candidateId: string;
    candidateRevision: number;
    contentHash: string;
    draft: AcquiredPodcastDraft;
    reviews: readonly [AcquiredMediaReview, AcquiredMediaReview];
    publishedAt: Date;
  }>): Promise<AcquiredMediaPublication>;
  archiveAcquiredPodcast(input: Readonly<{
    candidateId: string;
    publication: AcquiredMediaPublication;
    archivedAt: Date;
  }>): Promise<void>;
}
