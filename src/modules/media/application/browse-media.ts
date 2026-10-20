import type { MediaRepository } from "../repositories";
import { mediaBrowseQuerySchema, type MediaBrowseQuery } from "../schemas";

export function browseMedia(repository: MediaRepository, query: MediaBrowseQuery, userId: string) {
  return repository.browse(mediaBrowseQuerySchema.parse(query), userId);
}
