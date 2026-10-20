import { mediaStableKeySchema } from "../schemas";
import type { MediaRepository } from "../repositories";

/** The caller must authenticate before resolving a source for the byte proxy. */
export function getMediaStreamSource(repository: MediaRepository, stableKey: string, now = new Date()) {
  return repository.getStreamSource(mediaStableKeySchema.parse(stableKey), now);
}
