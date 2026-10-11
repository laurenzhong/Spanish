import { CandidatePublisherRegistry } from "./candidate-publisher-registry";
import { AcquiredArticlePublisher } from "./acquired-article-publisher";
import { AcquiredPodcastPublisher } from "./acquired-podcast-publisher";
import { AcquiredVideoPublisher } from "./acquired-video-publisher";
import { createDrizzleArticleRepository } from "@/src/modules/content/repositories";
import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { createBunnyStorageMediaArtworkStorage } from "@/src/modules/media/storage/artwork-storage";
import { getDatabase } from "@/src/shared/db/client";

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

/**
 * Artwork is copied into our own storage while a candidate is published, so the
 * publisher refuses to publish artwork when storage is not configured. That
 * refusal is intentional: a version must not keep pointing at a publisher URL.
 */
const artworkStorage = createBunnyStorageMediaArtworkStorage();

export const contentWorkflowPublishers = new CandidatePublisherRegistry([
  new AcquiredArticlePublisher(lazyArticleRepository),
  new AcquiredPodcastPublisher(lazyMediaRepository, { artworkStorage: artworkStorage ?? undefined }),
  new AcquiredVideoPublisher(lazyMediaRepository, { artworkStorage: artworkStorage ?? undefined }),
]);
