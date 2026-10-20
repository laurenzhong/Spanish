import { CandidatePublisherRegistry } from "./candidate-publisher-registry";
import { AcquiredArticlePublisher } from "./acquired-article-publisher";
import { AcquiredPodcastPublisher } from "./acquired-podcast-publisher";
import { AcquiredVideoPublisher } from "./acquired-video-publisher";
import { createDrizzleArticleRepository } from "@/src/modules/content/repositories";
import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { getDatabase } from "@/src/shared/db/client";
import { createSupabaseMediaArtworkStorage } from "@/src/modules/media/storage/artwork-storage";

const lazyArticleRepository = {
  publishAcquired: (...args: Parameters<ReturnType<typeof createDrizzleArticleRepository>["publishAcquired"]>) =>
    createDrizzleArticleRepository(getDatabase()).publishAcquired(...args),
  archiveAcquired: (...args: Parameters<ReturnType<typeof createDrizzleArticleRepository>["archiveAcquired"]>) =>
    createDrizzleArticleRepository(getDatabase()).archiveAcquired(...args),
};

const lazyMediaRepository = {
  publishAcquiredPodcast: (...args: Parameters<ReturnType<typeof createDrizzleMediaRepository>["publishAcquiredPodcast"]>) =>
    createDrizzleMediaRepository(getDatabase()).publishAcquiredPodcast(...args),
  archiveAcquiredPodcast: (...args: Parameters<ReturnType<typeof createDrizzleMediaRepository>["archiveAcquiredPodcast"]>) =>
    createDrizzleMediaRepository(getDatabase()).archiveAcquiredPodcast(...args),
  publishAcquiredVideo: (...args: Parameters<ReturnType<typeof createDrizzleMediaRepository>["publishAcquiredVideo"]>) =>
    createDrizzleMediaRepository(getDatabase()).publishAcquiredVideo(...args),
  archiveAcquiredVideo: (...args: Parameters<ReturnType<typeof createDrizzleMediaRepository>["archiveAcquiredVideo"]>) =>
    createDrizzleMediaRepository(getDatabase()).archiveAcquiredVideo(...args),
};

export const contentWorkflowPublishers = new CandidatePublisherRegistry([
  new AcquiredArticlePublisher(lazyArticleRepository),
  new AcquiredPodcastPublisher(lazyMediaRepository, { artworkStorage: createSupabaseMediaArtworkStorage() ?? undefined }),
  new AcquiredVideoPublisher(lazyMediaRepository, { artworkStorage: createSupabaseMediaArtworkStorage() ?? undefined }),
]);
