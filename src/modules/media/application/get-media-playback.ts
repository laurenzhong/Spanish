import { mediaStableKeySchema } from "../schemas";
import type { MediaRepository } from "../repositories";

export type GetMediaPlaybackOptions = Readonly<{ includeWords?: boolean }>;

export function getMediaPlayback(
  repository: MediaRepository,
  stableKey: string,
  userId: string,
  now = new Date(),
  options: GetMediaPlaybackOptions = {},
) {
  return repository.getPlayback(mediaStableKeySchema.parse(stableKey), userId, now, options);
}
