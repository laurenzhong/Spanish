import { archiveAcquiredPodcast, publishAcquiredPodcast, validateSegmentTimeline } from "@/src/modules/media";
import type { AcquiredMediaReview, AcquiredPodcastRepository } from "@/src/modules/media/repositories";

import { calculateLegacyPodcastCandidateContentHash, calculatePodcastCandidateContentHash, podcastCandidateDraftSchema } from "../normalizers";
import type { CandidatePublisher, CandidatePublisherInput } from "./candidate-publisher";

export class PodcastPublicationConflictError extends Error {
  readonly code = "CONTENT_PUBLICATION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "PodcastPublicationConflictError";
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
    && candidate.reviewerReference === "codex-ai-owner-authorized-review",
  );
  if (!review) throw new PodcastPublicationConflictError(`The ${dimension} review is missing or stale.`);
  return { locale, reviewerReference: "codex-ai-owner-authorized-review", notes: review.notes, reviewedAt };
}

export class AcquiredPodcastPublisher implements CandidatePublisher {
  readonly contentType = "podcast" as const;

  constructor(
    private readonly repository: AcquiredPodcastRepository,
    private readonly dependencies: Readonly<{ now?: () => Date }> = {},
  ) {}

  async publish(input: CandidatePublisherInput) {
    let draft;
    try {
      draft = podcastCandidateDraftSchema.parse(input.metadata.podcastDraft);
      if (draft.segments.length > 0) validateSegmentTimeline(draft.segments, draft.durationMs);
    } catch {
      throw new PodcastPublicationConflictError("The reviewed podcast draft or transcript timeline is invalid.");
    }
    const processingReview = input.metadata.mediaProcessingReview;
    if (processingReview && typeof processingReview === "object" && "status" in processingReview && processingReview.status === "blocked") {
      throw new PodcastPublicationConflictError("The media processing review is blocked by low-confidence transcript segments.");
    }
    const transcriptMatches = draft.transcriptStatus === "unavailable"
      ? draft.transcriptUrl === null && draft.segments.length === 0
      : draft.segments.length > 0
        && draft.segments.every((segment) => segment.sourceKind === draft.transcriptStatus)
        && (draft.transcriptStatus === "asr" ? draft.transcriptUrl === null : draft.transcriptUrl !== null);
    const legacyArtworkOmitted = !Object.prototype.hasOwnProperty.call(input.metadata.podcastDraft, "artwork");
    const legacyPlaybackProviderOmitted = !Object.prototype.hasOwnProperty.call(input.metadata.podcastDraft, "playbackProvider");
    const hashMatches = draft.contentHash === calculatePodcastCandidateContentHash(draft)
      || (legacyArtworkOmitted && legacyPlaybackProviderOmitted && draft.contentHash === calculateLegacyPodcastCandidateContentHash(draft));
    if (
      input.contentType !== "podcast"
      || input.contentHash !== draft.contentHash
      || !hashMatches
      || input.normalizedUrl !== draft.canonicalUrl
      || input.title !== draft.title
      || input.language !== "es"
      || !transcriptMatches
    ) {
      throw new PodcastPublicationConflictError("The podcast candidate no longer matches its reviewed draft.");
    }
    const publishedAt = (this.dependencies.now ?? (() => new Date()))();
    if (draft.playbackExpiresAt && new Date(draft.playbackExpiresAt).getTime() <= publishedAt.getTime()) {
      throw new PodcastPublicationConflictError("The reviewed podcast enclosure validation has expired.");
    }
    const reviews = [
      requiredReview(input, "content-es-ES", "es-ES", publishedAt),
      requiredReview(input, "teaching-zh-CN", "zh-CN", publishedAt),
    ] as const;
    return publishAcquiredPodcast(this.repository, {
      candidateId: input.candidateId,
      candidateRevision: input.candidateRevision,
      contentHash: input.contentHash,
      draft,
      reviews,
      publishedAt,
    });
  }

  async archive(input: Readonly<{
    publication: { kind: "article" | "media"; stableKey: string; version: number };
    candidateId: string;
  }>) {
    if (input.publication.kind !== "media") {
      throw new PodcastPublicationConflictError("A podcast publisher cannot archive an article publication.");
    }
    return archiveAcquiredPodcast(this.repository, {
      candidateId: input.candidateId,
      publication: { ...input.publication, kind: "media" },
      archivedAt: (this.dependencies.now ?? (() => new Date()))(),
    });
  }
}
