import type { ProfileEvidence } from "../domain/profile-overview";
import type { LearningActivityEvent } from "../domain/learning-activity";

export type ActivityAppendResult =
  | "closed"
  | "duplicate"
  | "inserted"
  | "not-found";
import type { LearningSession } from "../domain/learning-heatmap";
import type { SkillStateSnapshot } from "../domain/update-skill-state";

export type ProfileRepository = Readonly<{
  appendActivityEvent(
    userId: string,
    sessionId: string,
    event: Omit<LearningActivityEvent, "occurredAt">,
  ): Promise<ActivityAppendResult>;
  listEvidence(userId: string): Promise<readonly ProfileEvidence[]>;
  listLearningSessions(userId: string): Promise<readonly LearningSession[]>;
  listSkillStates(userId: string): Promise<readonly SkillStateSnapshot[]>;
}>;
