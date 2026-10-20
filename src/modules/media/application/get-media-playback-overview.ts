import { mediaStableKeySchema } from "../schemas";
import type { MediaRepository } from "../repositories";

/**
 * Lightweight playback projection for the media detail page: title, player
 * asset, resume progress and how many reviewed cues exist — no transcript
 * rows, so opening a video or podcast no longer waits for the word timings.
 */
export function getMediaPlaybackOverview(repository: MediaRepository, stableKey: string, userId: string, now = new Date()) {
  return repository.getPlaybackOverview(mediaStableKeySchema.parse(stableKey), userId, now);
}
