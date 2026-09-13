import type { MediaRepository } from "../repositories";
import { mediaListQuerySchema, type MediaListQuery } from "../schemas";

export function listMedia(repository: MediaRepository, query: MediaListQuery, userId?: string) {
  return repository.list(mediaListQuerySchema.parse(query), userId);
}
