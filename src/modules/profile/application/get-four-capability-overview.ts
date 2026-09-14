import { buildFourCapabilityOverview, type FourCapabilityOverview } from "../domain";
import type { ProfileRepository } from "../repositories/profile-repository";

export async function getFourCapabilityOverview(repository: ProfileRepository, userId: string): Promise<FourCapabilityOverview> {
  const [states, evidence] = await Promise.all([repository.listSkillStates(userId), repository.listEvidence(userId)]);
  return buildFourCapabilityOverview(userId, states, evidence);
}
