import type { ExploreRepository, ExploreUserStateRepository } from "../domain";

export const emptyExploreUserStateRepository: ExploreUserStateRepository = {
  async getForUser() {
    return { status: "unavailable", packs: {} };
  },
};

export type ExploreRepositoryFactory = Readonly<{
  repository: ExploreRepository;
  userStateRepository: ExploreUserStateRepository;
}>;

