import {
  learningObservationInputSchema,
  type LearningObservationInput,
  toLearningObservationEvent,
} from "../domain/learning-observation";
import type {
  LearningObservationAppendResult,
  LearningObservationRepository,
} from "../repositories/learning-observation-repository";

export type RecordLearningObservationDependencies = Readonly<{
  repository: LearningObservationRepository;
  now?: () => Date;
  id?: () => string;
}>;

export async function recordLearningObservation(
  dependencies: RecordLearningObservationDependencies,
  userId: string,
  input: LearningObservationInput,
): Promise<LearningObservationAppendResult> {
  const parsed = learningObservationInputSchema.parse(input);
  const preferences = await dependencies.repository.getPreferences(userId);
  if (!preferences.learningInsightsEnabled) return "disabled";
  if (parsed.eventType === "assistant_intent" && !preferences.recordAssistantLearningIntent) {
    return "disabled";
  }
  const event = toLearningObservationEvent(parsed, {
    userId,
    now: dependencies.now,
    id: dependencies.id,
  });
  return dependencies.repository.appendObservation(userId, event);
}

export type { LearningObservationInput };
