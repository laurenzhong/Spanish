import { buildProfileOverview, type ProfileOverview } from "../domain/profile-overview";
import type { ProfileRepository } from "../repositories/profile-repository";

export async function getProfileOverview(
  repository: ProfileRepository,
  userId: string,
): Promise<ProfileOverview> {
  const [states, evidence] = await Promise.all([
    repository.listSkillStates(userId),
    repository.listEvidence(userId),
  ]);

  return buildProfileOverview(userId, states, evidence);
}
