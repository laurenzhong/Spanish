import type {
  LearningObservationEvent,
  LearningObservationInput,
} from "../domain/learning-observation";
import type {
  LearningReportFeedback,
  LearningReportFeedbackState,
  LearningReportSnapshot,
} from "../domain/report";

export type LearningReportRecord = LearningReportSnapshot & Readonly<{
  id: string;
  generationId: string;
}>;

export type LearningInsightsPreferences = Readonly<{
  learningInsightsEnabled: boolean;
  recordAssistantLearningIntent: boolean;
}>;

export type LearningObservationAppendResult = "inserted" | "duplicate" | "disabled";

export type LearningObservationRepository = Readonly<{
  getPreferences(userId: string): Promise<LearningInsightsPreferences>;
  updatePreferences(
    userId: string,
    preferences: LearningInsightsPreferences,
  ): Promise<LearningInsightsPreferences>;
  appendObservation(
    userId: string,
    event: LearningObservationEvent,
  ): Promise<LearningObservationAppendResult>;
  listObservations(
    userId: string,
    options?: Readonly<{ since?: Date; limit?: number }>,
  ): Promise<readonly LearningObservationEvent[]>;
}>;

export type LearningReportRepository = LearningObservationRepository & Readonly<{
  getUserTimezone(userId: string): Promise<string>;
  getReport(userId: string, localDate: string, reportVersion: number): Promise<LearningReportRecord | null>;
  getReportById(userId: string, reportId: string): Promise<LearningReportRecord | null>;
  saveReport(userId: string, report: LearningReportSnapshot, generationId: string): Promise<LearningReportRecord>;
  recordReportFeedback(
    userId: string,
    reportId: string,
    candidateKey: string,
    feedback: LearningReportFeedback,
    dedupeKey: string,
  ): Promise<LearningReportFeedbackState>;
  listReportFeedback(userId: string, reportId: string): Promise<readonly LearningReportFeedbackState[]>;
  listAllReportFeedback(userId: string): Promise<readonly LearningReportFeedbackState[]>;
}>;

export type LearningObservationRecorder = Readonly<{
  record(
    userId: string,
    input: LearningObservationInput,
  ): Promise<LearningObservationAppendResult>;
}>;
