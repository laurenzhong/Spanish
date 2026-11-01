import { learningInsightsPreferencesSchema } from "../domain/learning-observation";
import type {
  LearningInsightsPreferences,
  LearningObservationRepository,
} from "../repositories/learning-observation-repository";

export async function getLearningInsightsPreferences(
  repository: LearningObservationRepository,
  userId: string,
): Promise<LearningInsightsPreferences> {
  return repository.getPreferences(userId);
}

export async function updateLearningInsightsPreferences(
  repository: LearningObservationRepository,
  userId: string,
  input: unknown,
): Promise<LearningInsightsPreferences> {
  const preferences = learningInsightsPreferencesSchema.parse(input);
  return repository.updatePreferences(userId, preferences);
}
