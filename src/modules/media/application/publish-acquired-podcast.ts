import type { MediaArtwork } from "../domain";
import type {
  AcquiredMediaPublication,
  AcquiredMediaReview,
  AcquiredPodcastDraft,
  AcquiredPodcastRepository,
} from "../repositories";

export function publishAcquiredPodcast(repository: AcquiredPodcastRepository, input: Readonly<{
  candidateId: string;
  candidateRevision: number;
  contentHash: string;
  draft: AcquiredPodcastDraft;
  /** Durable artwork snapshot; falls back to the draft artwork when absent. */
  artworkOverride?: MediaArtwork | null;
  reviews: readonly [AcquiredMediaReview, AcquiredMediaReview];
  publishedAt: Date;
}>): Promise<AcquiredMediaPublication> {
  return repository.publishAcquiredPodcast(input);
}

export function archiveAcquiredPodcast(repository: AcquiredPodcastRepository, input: Readonly<{
  candidateId: string;
  publication: AcquiredMediaPublication;
  archivedAt: Date;
}>): Promise<void> {
  return repository.archiveAcquiredPodcast(input);
}
