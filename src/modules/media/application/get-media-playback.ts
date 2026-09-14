import { mediaStableKeySchema } from "../schemas";
import type { MediaRepository } from "../repositories";

export function getMediaPlayback(repository: MediaRepository, stableKey: string, userId: string, now = new Date()) {
  return repository.getPlayback(mediaStableKeySchema.parse(stableKey), userId, now);
}
