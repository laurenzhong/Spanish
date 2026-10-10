import { publishAcquiredVideo, archiveAcquiredVideo } from "@/src/modules/media/application";
import { validateSegmentTimeline } from "@/src/modules/media/domain";
import type { AcquiredMediaReview, AcquiredVideoRepository, HostedVideoAsset } from "@/src/modules/media/repositories";
import type { MediaArtworkStorage } from "@/src/modules/media/storage/artwork-storage";
import { z } from "zod";

import { calculateLegacyVideoCandidateContentHash, calculateVideoCandidateContentHash, videoCandidateDraftSchema } from "../normalizers";
import { isOwnerAuthorizedReviewerReference } from "../domain";
import type { CandidatePublisher, CandidatePublisherInput } from "./candidate-publisher";

export class VideoPublicationConflictError extends Error {
  readonly code = "CONTENT_PUBLICATION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "VideoPublicationConflictError";
  }
}

function requiredReview(
  input: CandidatePublisherInput,
  dimension: "content-es-ES" | "teaching-zh-CN",
  locale: AcquiredMediaReview["locale"],
  reviewedAt: Date,
): AcquiredMediaReview {
  const review = input.reviews.find((candidate) =>
    candidate.dimension === dimension
    && candidate.status === "approved"
    && candidate.candidateRevision === input.candidateRevision
    && isOwnerAuthorizedReviewerReference(candidate.reviewerReference),
  );
  if (!review) throw new VideoPublicationConflictError(`The ${dimension} review is missing or stale.`);
  // Echo the stored audit identity instead of the platform that is running now.
  return { locale, reviewerReference: review.reviewerReference as string, notes: review.notes, reviewedAt };
}

const hostedVideoAssetSchema = z.strictObject({
  providerKey: z.literal("bunny-storage"),
  playbackUrl: z.url(),
  mimeType: z.literal("video/mp4"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  byteSize: z.number().int().positive(),
});

function parseHostedVideoAsset(value: unknown): HostedVideoAsset {
  const asset = hostedVideoAssetSchema.safeParse(value);
  if (!asset.success) throw new VideoPublicationConflictError("The video must be hosted as a validated Bunny MP4 before publication.");
  const url = new URL(asset.data.playbackUrl);
  const configuredHost = process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME?.trim().toLowerCase();
  const allowedHost = configuredHost ? url.hostname.toLowerCase() === configuredHost : url.hostname.toLowerCase().endsWith(".b-cdn.net");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.startsWith("/media/") || !allowedHost) {
    throw new VideoPublicationConflictError("The video must use a stable Bunny Storage Pull Zone MP4 URL.");
  }
  return asset.data;
}

export class AcquiredVideoPublisher implements CandidatePublisher {
  readonly contentType = "video" as const;

  constructor(
    private readonly repository: AcquiredVideoRepository,
    private readonly dependencies: Readonly<{ now?: () => Date; artworkStorage?: MediaArtworkStorage }> = {},
  ) {}

  async publish(input: CandidatePublisherInput) {
    let draft;
    try {
      draft = videoCandidateDraftSchema.parse(input.metadata.videoDraft);
      if (draft.segments.length > 0) validateSegmentTimeline(draft.segments, draft.durationMs);
    } catch {
      throw new VideoPublicationConflictError("The reviewed video draft or segment timeline is invalid.");
    }
    const processingReview = input.metadata.mediaProcessingReview;
    if (processingReview && typeof processingReview === "object" && "status" in processingReview && processingReview.status === "blocked") {
      throw new VideoPublicationConflictError("The media processing review is blocked by low-confidence transcript segments.");
    }
    const captionMatches = draft.captionStatus === "unavailable"
      ? draft.segments.length === 0
      : draft.segments.length > 0 && draft.segments.every((segment) => segment.sourceKind === draft.captionStatus);
    if (input.requireBilingualSubtitles && !hasBilingualSegments(draft.segments)) {
      throw new VideoPublicationConflictError("Bilingual subtitles are required before daily video publication.");
    }
    const hostedAsset = parseHostedVideoAsset(input.metadata.bunnyVideoAsset);
    const legacyArtworkOmitted = !Object.prototype.hasOwnProperty.call(input.metadata.videoDraft, "artwork");
    const hashMatches = draft.contentHash === calculateVideoCandidateContentHash(draft)
      || (legacyArtworkOmitted && draft.contentHash === calculateLegacyVideoCandidateContentHash(draft));
    if (
      input.contentType !== "video"
      || input.contentHash !== draft.contentHash
      || !hashMatches
      || input.normalizedUrl !== draft.canonicalUrl
      || input.title !== draft.title
      || input.language !== "es"
      || draft.canonicalUrl !== `https://www.youtube.com/watch?v=${draft.platformVideoId}`
      || draft.embedUrl !== `https://www.youtube-nocookie.com/embed/${draft.platformVideoId}?enablejsapi=1`
      || !captionMatches
    ) {
      throw new VideoPublicationConflictError("The video candidate no longer matches its reviewed draft.");
    }
    const reviewedAt = (this.dependencies.now ?? (() => new Date()))();
    const reviews = [
      requiredReview(input, "content-es-ES", "es-ES", reviewedAt),
      requiredReview(input, "teaching-zh-CN", "zh-CN", reviewedAt),
    ] as const;
    if (draft.artwork && !this.dependencies.artworkStorage) throw new VideoPublicationConflictError("Durable artwork storage is not configured.");
    const artworkOverride = draft.artwork && this.dependencies.artworkStorage
      ? await this.dependencies.artworkStorage.snapshot({ stableKey: draft.stableKey, revision: input.candidateRevision, artwork: draft.artwork })
      : draft.artwork;
    return publishAcquiredVideo(this.repository, {
      candidateId: input.candidateId,
      candidateRevision: input.candidateRevision,
      contentHash: input.contentHash,
      draft,
      artworkOverride,
      hostedAsset,
      reviews,
      publishedAt: reviewedAt,
    });
  }

  async archive(input: Readonly<{ publication: { kind: "article" | "media"; stableKey: string; version: number }; candidateId: string }>) {
    if (input.publication.kind !== "media") {
      throw new VideoPublicationConflictError("A video publisher cannot archive an article publication.");
    }
    return archiveAcquiredVideo(this.repository, {
      candidateId: input.candidateId,
      publication: { ...input.publication, kind: "media" },
      archivedAt: (this.dependencies.now ?? (() => new Date()))(),
    });
  }
}

function hasBilingualSegments(segments: readonly Readonly<{ sourceText: string; translation: string | null }>[]): boolean {
  return segments.length > 0 && segments.every((segment) => segment.sourceText.trim().length > 0 && Boolean(segment.translation?.trim()));
}
