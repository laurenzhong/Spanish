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
