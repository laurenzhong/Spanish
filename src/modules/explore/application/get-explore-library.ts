import type { ExploreLibraryDto } from "../domain/explore-library";
import type { ExploreLibraryRepository, ExploreLibraryRepositoryOptions } from "../repositories/catalog-explore-library-repository";

export async function getExploreLibraryForUser(
  repository: ExploreLibraryRepository,
  userId: string,
  options: ExploreLibraryRepositoryOptions = {},
): Promise<ExploreLibraryDto> {
  if (!userId.trim()) throw new Error("A user id is required.");
  return repository.getForUser(userId, options);
}
