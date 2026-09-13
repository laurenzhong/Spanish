import type { ContentCandidateType } from "../schemas";
import type { CandidateReviewRecord } from "../domain";

export type CandidatePublicationRef = Readonly<{
  kind: "article" | "media";
  stableKey: string;
  version: number;
}>;

export type CandidatePublisherInput = Readonly<{
  candidateId: string;
  candidateRevision: number;
  contentHash: string;
  contentType: ContentCandidateType;
  title: string;
  language: string;
  normalizedUrl: string;
  metadata: Readonly<Record<string, unknown>>;
  reviews: readonly CandidateReviewRecord[];
}>;

export interface CandidatePublisher {
  readonly contentType: ContentCandidateType;
  publish(input: CandidatePublisherInput): Promise<CandidatePublicationRef>;
  archive(input: Readonly<{ publication: CandidatePublicationRef; candidateId: string }>): Promise<void>;
}
