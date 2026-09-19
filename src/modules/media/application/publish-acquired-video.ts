import type {
  AcquiredMediaPublication,
  AcquiredMediaReview,
  AcquiredVideoDraft,
  HostedVideoAsset,
  AcquiredVideoRepository,
} from "../repositories";

export function publishAcquiredVideo(repository: AcquiredVideoRepository, input: Readonly<{
  candidateId: string;
  candidateRevision: number;
  contentHash: string;
  draft: AcquiredVideoDraft;
  hostedAsset: HostedVideoAsset;
  reviews: readonly [AcquiredMediaReview, AcquiredMediaReview];
  publishedAt: Date;
}>): Promise<AcquiredMediaPublication> {
  return repository.publishAcquiredVideo(input);
}

export function archiveAcquiredVideo(repository: AcquiredVideoRepository, input: Readonly<{
  candidateId: string;
  publication: AcquiredMediaPublication;
  archivedAt: Date;
}>): Promise<void> {
  return repository.archiveAcquiredVideo(input);
}
