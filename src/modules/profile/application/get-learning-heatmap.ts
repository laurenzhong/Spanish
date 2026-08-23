import {
  buildLearningHeatmap,
  type LearningHeatmap,
} from "../domain/learning-heatmap";
import type { ProfileRepository } from "../repositories/profile-repository";

export async function getLearningHeatmap(
  repository: ProfileRepository,
  userId: string,
  generatedAt = new Date(),
): Promise<LearningHeatmap> {
  return buildLearningHeatmap(
    await repository.listLearningSessions(userId),
    generatedAt,
  );
}
