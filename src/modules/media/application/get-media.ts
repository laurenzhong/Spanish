import { mediaStableKeySchema } from "../schemas";
import type { MediaRepository } from "../repositories";

export function getMedia(repository: MediaRepository, stableKey: string, userId?: string) {
  return repository.findByStableKey(mediaStableKeySchema.parse(stableKey), userId);
}
