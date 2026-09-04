import { getExploreDashboard, type ExploreDashboardDto, type ExploreDashboardOptions, type ExploreRepository, type ExploreUserStateRepository } from "../domain";

export async function getExploreDashboardForUser(
  repository: ExploreRepository,
  userStateRepository: ExploreUserStateRepository,
  userId: string,
  options: ExploreDashboardOptions = {},
): Promise<ExploreDashboardDto> {
  return getExploreDashboard(repository, userId, userStateRepository, options);
}
