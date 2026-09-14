import { CandidatePublisherRegistry } from "./candidate-publisher-registry";
import { AcquiredArticlePublisher } from "./acquired-article-publisher";
import { AcquiredVideoPublisher } from "./acquired-video-publisher";
import { createDrizzleArticleRepository } from "@/src/modules/content/repositories";
import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { getDatabase } from "@/src/shared/db/client";

const lazyArticleRepository = {
  publishAcquired: (...args: Parameters<ReturnType<typeof createDrizzleArticleRepository>["publishAcquired"]>) =>
    createDrizzleArticleRepository(getDatabase()).publishAcquired(...args),
  archiveAcquired: (...args: Parameters<ReturnType<typeof createDrizzleArticleRepository>["archiveAcquired"]>) =>
    createDrizzleArticleRepository(getDatabase()).archiveAcquired(...args),
};

const lazyVideoRepository = {
  publishAcquiredVideo: (...args: Parameters<ReturnType<typeof createDrizzleMediaRepository>["publishAcquiredVideo"]>) =>
    createDrizzleMediaRepository(getDatabase()).publishAcquiredVideo(...args),
  archiveAcquiredVideo: (...args: Parameters<ReturnType<typeof createDrizzleMediaRepository>["archiveAcquiredVideo"]>) =>
    createDrizzleMediaRepository(getDatabase()).archiveAcquiredVideo(...args),
};

export const contentWorkflowPublishers = new CandidatePublisherRegistry([
  new AcquiredArticlePublisher(lazyArticleRepository),
  new AcquiredVideoPublisher(lazyVideoRepository),
]);
