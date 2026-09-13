import { CandidatePublisherRegistry } from "./candidate-publisher-registry";
import { AcquiredArticlePublisher } from "./acquired-article-publisher";
import { createDrizzleArticleRepository } from "@/src/modules/content/repositories";
import { getDatabase } from "@/src/shared/db/client";

const lazyArticleRepository = {
  publishAcquired: (...args: Parameters<ReturnType<typeof createDrizzleArticleRepository>["publishAcquired"]>) =>
    createDrizzleArticleRepository(getDatabase()).publishAcquired(...args),
  archiveAcquired: (...args: Parameters<ReturnType<typeof createDrizzleArticleRepository>["archiveAcquired"]>) =>
    createDrizzleArticleRepository(getDatabase()).archiveAcquired(...args),
};

// Media remains fail-closed until MEDIA-001 registers its production publisher.
export const contentWorkflowPublishers = new CandidatePublisherRegistry([
  new AcquiredArticlePublisher(lazyArticleRepository),
]);
