import { ContentPublisherNotAvailableError } from "../domain/review-gate";
import type { ContentCandidateType } from "../schemas";
import type { CandidatePublisher } from "./candidate-publisher";

export class CandidatePublisherRegistry {
  private readonly publishers = new Map<ContentCandidateType, CandidatePublisher>();

  constructor(publishers: readonly CandidatePublisher[] = []) {
    for (const publisher of publishers) this.publishers.set(publisher.contentType, publisher);
  }

  has(contentType: ContentCandidateType): boolean {
    return this.publishers.has(contentType);
  }

  require(contentType: ContentCandidateType): CandidatePublisher {
    const publisher = this.publishers.get(contentType);
    if (!publisher) throw new ContentPublisherNotAvailableError(contentType);
    return publisher;
  }
}
