import { and, asc, eq, gte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type {
  LearningObservationEvent,
} from "../domain/learning-observation";
import type { LearningReportFeedback, LearningReportSnapshot } from "../domain/report";
import type {
  LearningInsightsPreferences,
  LearningObservationAppendResult,
  LearningReportRepository,
  LearningReportRecord,
} from "./learning-observation-repository";

type LearningInsightsDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof schema
>;

const DEFAULT_PREFERENCES: LearningInsightsPreferences = {
  learningInsightsEnabled: true,
  recordAssistantLearningIntent: true,
};

function toEvent(row: typeof schema.learningObservationEvents.$inferSelect): LearningObservationEvent {
  return {
    id: row.id,
    userId: row.userId,
    eventType: row.eventType as LearningObservationEvent["eventType"],
    sourceModule: row.sourceModule as LearningObservationEvent["sourceModule"],
    subjectType: row.subjectType as LearningObservationEvent["subjectType"],
    subjectId: row.subjectId,
    subjectVersion: row.subjectVersion,
    signalStrength: row.signalStrength as LearningObservationEvent["signalStrength"],
    metadata: row.metadata,
    occurredAt: row.occurredAt,
    dedupeKey: row.dedupeKey,
    algorithmVersion: row.algorithmVersion,
    retentionUntil: row.retentionUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toReport(row: typeof schema.learningInsightReports.$inferSelect): LearningReportRecord {
  return {
    id: row.id,
    generationId: row.generationId,
    localDate: row.localDate,
    timezone: row.timezone,
    status: row.status as LearningReportRecord["status"],
    reportVersion: row.reportVersion,
    algorithmVersion: row.algorithmVersion,
    summary: row.summary,
    coverage: row.coverage as LearningReportRecord["coverage"],
    candidates: row.candidates as LearningReportRecord["candidates"],
    sourceEventIds: row.sourceEventIds as string[],
  };
}

export function createDrizzleLearningObservationRepository<
  TResult extends PgQueryResultHKT,
>(database: LearningInsightsDatabase<TResult>): LearningReportRepository {
  return {
    async getUserTimezone(userId) {
      const [row] = await database.select({ timezone: schema.profiles.timezone })
        .from(schema.profiles)
        .where(eq(schema.profiles.id, userId))
        .limit(1);
      return row?.timezone ?? "Asia/Shanghai";
    },

    async getPreferences(userId) {
      const [row] = await database
        .select({
          learningInsightsEnabled: schema.userPreferences.learningInsightsEnabled,
          recordAssistantLearningIntent: schema.userPreferences.recordAssistantLearningIntent,
        })
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
        .limit(1);
      return row ?? DEFAULT_PREFERENCES;
    },

    async updatePreferences(userId, preferences) {
      const [row] = await database
        .insert(schema.userPreferences)
        .values({ userId, ...preferences })
        .onConflictDoUpdate({
          target: schema.userPreferences.userId,
          set: { ...preferences, updatedAt: new Date() },
        })
        .returning({
          learningInsightsEnabled: schema.userPreferences.learningInsightsEnabled,
          recordAssistantLearningIntent: schema.userPreferences.recordAssistantLearningIntent,
        });
      return row ?? preferences;
    },

    async appendObservation(userId, event): Promise<LearningObservationAppendResult> {
      const preferences = await this.getPreferences(userId);
      if (!preferences.learningInsightsEnabled) return "disabled";
      if (
        event.eventType === "assistant_intent" &&
        !preferences.recordAssistantLearningIntent
      ) {
        return "disabled";
      }
      const [inserted] = await database
        .insert(schema.learningObservationEvents)
        .values({
          id: event.id,
          userId,
          eventType: event.eventType,
          sourceModule: event.sourceModule,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          subjectVersion: event.subjectVersion,
          signalStrength: event.signalStrength,
          metadata: event.metadata,
          occurredAt: event.occurredAt,
          dedupeKey: event.dedupeKey,
          algorithmVersion: event.algorithmVersion,
          retentionUntil: event.retentionUntil,
        })
        .onConflictDoNothing({
          target: [
            schema.learningObservationEvents.userId,
            schema.learningObservationEvents.dedupeKey,
          ],
        })
        .returning({ id: schema.learningObservationEvents.id });
      return inserted ? "inserted" : "duplicate";
    },

    async listObservations(userId, options = {}) {
      const filters = [eq(schema.learningObservationEvents.userId, userId)];
      if (options.since) {
        filters.push(gte(schema.learningObservationEvents.occurredAt, options.since));
      }
      const rows = await database
        .select()
        .from(schema.learningObservationEvents)
        .where(and(...filters))
        .orderBy(asc(schema.learningObservationEvents.occurredAt))
        .limit(Math.min(Math.max(options.limit ?? 500, 1), 2_000));
      return rows.map(toEvent);
    },

    async getReport(userId, localDate, reportVersion) {
      const [row] = await database
        .select()
        .from(schema.learningInsightReports)
        .where(and(
          eq(schema.learningInsightReports.userId, userId),
          eq(schema.learningInsightReports.localDate, localDate),
          eq(schema.learningInsightReports.reportVersion, reportVersion),
        ))
        .limit(1);
      return row ? toReport(row) : null;
    },

    async getReportById(userId, reportId) {
      const [row] = await database.select().from(schema.learningInsightReports).where(and(
        eq(schema.learningInsightReports.userId, userId),
        eq(schema.learningInsightReports.id, reportId),
      )).limit(1);
      return row ? toReport(row) : null;
    },

    async saveReport(userId, report: LearningReportSnapshot, generationId) {
      await database.insert(schema.learningInsightReports).values({
        userId,
        localDate: report.localDate,
        timezone: report.timezone,
        reportVersion: report.reportVersion,
        status: report.status,
        coverage: { ...report.coverage },
        summary: report.summary,
        candidates: [...report.candidates],
        sourceEventIds: [...report.sourceEventIds],
        generationId,
        algorithmVersion: report.algorithmVersion,
      }).onConflictDoNothing({ target: [
        schema.learningInsightReports.userId,
        schema.learningInsightReports.localDate,
        schema.learningInsightReports.reportVersion,
      ] });
      const [saved] = await database.select().from(schema.learningInsightReports).where(and(
        eq(schema.learningInsightReports.userId, userId),
        eq(schema.learningInsightReports.localDate, report.localDate),
        eq(schema.learningInsightReports.reportVersion, report.reportVersion),
      )).limit(1);
      if (!saved) throw new Error("learning-report-save-failed");
      return toReport(saved);
    },

    async recordReportFeedback(userId, reportId, candidateKey, feedback: LearningReportFeedback, dedupeKey) {
      await database.insert(schema.learningInsightFeedback).values({
        userId,
        reportId,
        candidateKey,
        feedback,
        dedupeKey,
      }).onConflictDoNothing({ target: [
        schema.learningInsightFeedback.userId,
        schema.learningInsightFeedback.reportId,
        schema.learningInsightFeedback.candidateKey,
        schema.learningInsightFeedback.dedupeKey,
      ] });
      const [row] = await database.select({
        candidateKey: schema.learningInsightFeedback.candidateKey,
        feedback: schema.learningInsightFeedback.feedback,
      }).from(schema.learningInsightFeedback).where(and(
        eq(schema.learningInsightFeedback.userId, userId),
        eq(schema.learningInsightFeedback.reportId, reportId),
        eq(schema.learningInsightFeedback.candidateKey, candidateKey),
        eq(schema.learningInsightFeedback.dedupeKey, dedupeKey),
      )).limit(1);
      if (!row) throw new Error("learning-feedback-save-failed");
      return { candidateKey: row.candidateKey, feedback: row.feedback as LearningReportFeedback };
    },

    async listReportFeedback(userId, reportId) {
      const rows = await database.select({
        candidateKey: schema.learningInsightFeedback.candidateKey,
        feedback: schema.learningInsightFeedback.feedback,
      }).from(schema.learningInsightFeedback).where(and(
        eq(schema.learningInsightFeedback.userId, userId),
        eq(schema.learningInsightFeedback.reportId, reportId),
      ));
      return rows.map((row) => ({ candidateKey: row.candidateKey, feedback: row.feedback as LearningReportFeedback }));
    },

    async listAllReportFeedback(userId) {
      const rows = await database.select({
        candidateKey: schema.learningInsightFeedback.candidateKey,
        feedback: schema.learningInsightFeedback.feedback,
      }).from(schema.learningInsightFeedback).where(eq(schema.learningInsightFeedback.userId, userId));
      return rows.map((row) => ({ candidateKey: row.candidateKey, feedback: row.feedback as LearningReportFeedback }));
    },
  };
}
