import type { ProfileEvidence } from "../domain/profile-overview";
import type { LearningSession } from "../domain/learning-heatmap";
import type { SkillStateSnapshot } from "../domain/update-skill-state";

export type ProfileRepository = Readonly<{
  listEvidence(userId: string): Promise<readonly ProfileEvidence[]>;
  listLearningSessions(userId: string): Promise<readonly LearningSession[]>;
  listSkillStates(userId: string): Promise<readonly SkillStateSnapshot[]>;
}>;
