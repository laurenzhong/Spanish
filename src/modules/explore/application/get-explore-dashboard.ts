import { getExploreDashboard, type ExploreDashboardDto, type ExploreRepository, type ExploreUserStateRepository } from "../domain";

export async function getExploreDashboardForUser(
  repository: ExploreRepository,
  userStateRepository: ExploreUserStateRepository,
  userId: string,
): Promise<ExploreDashboardDto> {
  return getExploreDashboard(repository, userId, userStateRepository);
}

