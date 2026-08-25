import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

import type { ProfileRepository } from "./profile-repository";
import { activeSecondsForEvents } from "../domain/learning-activity";

type ProfileDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof schema
>;

function sceneLabel(title: unknown): string | null {
  if (!title || typeof title !== "object") return null;
  const localized = title as Record<string, unknown>;
  return typeof localized.zh === "string"
    ? localized.zh
    : typeof localized.es === "string"
      ? localized.es
      : null;
}

export function createDrizzleProfileRepository<
  TResult extends PgQueryResultHKT,
>(database: ProfileDatabase<TResult>): ProfileRepository {
  return {
    async appendActivityEvent(userId, sessionId, event) {
      const existing = await database
        .select({ id: schema.practiceSessionActivityEvents.id })
        .from(schema.practiceSessionActivityEvents)
        .where(
          and(
            eq(schema.practiceSessionActivityEvents.userId, userId),
            eq(schema.practiceSessionActivityEvents.sessionId, sessionId),
            eq(
              schema.practiceSessionActivityEvents.clientInstanceId,
              event.clientInstanceId,
            ),
            eq(schema.practiceSessionActivityEvents.sequence, event.sequence),
          ),
        )
        .limit(1);
      if (existing.length > 0) return "duplicate";

      const [session] = await database
        .select({ status: schema.practiceSessions.status })
        .from(schema.practiceSessions)
        .where(
          and(
            eq(schema.practiceSessions.id, sessionId),
            eq(schema.practiceSessions.userId, userId),
          ),
        )
        .limit(1);
      if (!session) return "not-found";
      if (event.eventType !== "ended" && session.status !== "active") {
        return "closed";
      }

      const inserted = await database
        .insert(schema.practiceSessionActivityEvents)
        .values({
          clientInstanceId: event.clientInstanceId,
          eventType: event.eventType,
          sequence: event.sequence,
          sessionId,
          userId,
        })
        .onConflictDoNothing({
          target: [
            schema.practiceSessionActivityEvents.sessionId,
            schema.practiceSessionActivityEvents.clientInstanceId,
            schema.practiceSessionActivityEvents.sequence,
          ],
        })
        .returning({ id: schema.practiceSessionActivityEvents.id });
      return inserted.length > 0 ? "inserted" : "duplicate";
    },

    async listEvidence(userId) {
      const rows = await database
        .select({
          confidence: schema.evidenceEvents.confidence,
          occurredAt: schema.evidenceEvents.occurredAt,
          evidenceWeight: schema.evidenceEvents.evidenceWeight,
          skillKey: schema.evidenceEvents.skillKey,
          modality: schema.evidenceEvents.modality,
          outcomeScore: schema.evidenceEvents.outcomeScore,
          practiceAttemptId: schema.evidenceEvents.practiceAttemptId,
          hintLevel: schema.practiceAttempts.hintLevel,
          sceneTitle: schema.scenarios.title,
        })
        .from(schema.evidenceEvents)
        .leftJoin(
          schema.practiceAttempts,
          eq(schema.evidenceEvents.practiceAttemptId, schema.practiceAttempts.id),
        )
        .leftJoin(
          schema.scenarioTasks,
          eq(schema.practiceAttempts.scenarioTaskId, schema.scenarioTasks.id),
        )
        .leftJoin(
          schema.scenarios,
          eq(schema.scenarioTasks.scenarioId, schema.scenarios.id),
        )
        .where(eq(schema.evidenceEvents.userId, userId))
        .orderBy(desc(schema.evidenceEvents.occurredAt));

      return rows.map((row) => ({
        confidence: row.confidence,
        occurredAt: row.occurredAt,
        evidenceWeight: row.evidenceWeight,
        skillKey: row.skillKey,
        modality: row.modality,
        outcomeScore: row.outcomeScore,
        practiceAttemptId: row.practiceAttemptId,
        hintLevel: row.hintLevel,
        sceneLabel: sceneLabel(row.sceneTitle),
      }));
    },

    async listSkillStates(userId) {
      const rows = await database
        .select()
        .from(schema.userSkillStates)
        .where(eq(schema.userSkillStates.userId, userId));

      return rows.map((row) => ({
        confidence: row.confidence,
        evidenceCount: row.evidenceCount,
        lastEvidenceAt: row.lastEvidenceAt,
        mastery: row.mastery,
        skillKey: row.skillKey,
        snapshotVersion: row.snapshotVersion,
        userId: row.userId,
      }));
    },

    async listLearningSessions(userId) {
      const now = new Date();
      const from = new Date(now);
      from.setUTCDate(from.getUTCDate() - 364);
      const sessions = await database
        .select({
          completedAt: schema.practiceSessions.completedAt,
          id: schema.practiceSessions.id,
          sceneTitle: schema.scenarios.title,
          startedAt: schema.practiceSessions.startedAt,
          status: schema.practiceSessions.status,
        })
        .from(schema.practiceSessions)
        .leftJoin(
          schema.scenarios,
          eq(schema.practiceSessions.scenarioId, schema.scenarios.id),
        )
        .where(
          and(
            eq(schema.practiceSessions.userId, userId),
            gte(schema.practiceSessions.startedAt, from),
            lte(schema.practiceSessions.startedAt, now),
          ),
        )
        .orderBy(desc(schema.practiceSessions.startedAt));

      const attempts = await database
        .select({
          id: schema.practiceAttempts.id,
          hintLevel: schema.practiceAttempts.hintLevel,
          modality: schema.practiceAttempts.modality,
          responseText: schema.practiceAttempts.responseText,
          sessionId: schema.practiceAttempts.sessionId,
        })
        .from(schema.practiceAttempts)
        .where(eq(schema.practiceAttempts.userId, userId));

      const evidence = await database
        .select({
          practiceAttemptId: schema.evidenceEvents.practiceAttemptId,
          skillKey: schema.evidenceEvents.skillKey,
        })
        .from(schema.evidenceEvents)
        .where(eq(schema.evidenceEvents.userId, userId));

      const activityEvents = await database
        .select({
          clientInstanceId: schema.practiceSessionActivityEvents.clientInstanceId,
          eventType: schema.practiceSessionActivityEvents.eventType,
          occurredAt: schema.practiceSessionActivityEvents.occurredAt,
          sequence: schema.practiceSessionActivityEvents.sequence,
          sessionId: schema.practiceSessionActivityEvents.sessionId,
        })
        .from(schema.practiceSessionActivityEvents)
        .where(
          and(
            eq(schema.practiceSessionActivityEvents.userId, userId),
            gte(schema.practiceSessionActivityEvents.occurredAt, from),
          ),
        );
      const activityBySession = new Map<string, typeof activityEvents>();
      for (const event of activityEvents) {
        const existing = activityBySession.get(event.sessionId) ?? [];
        existing.push(event);
        activityBySession.set(event.sessionId, existing);
      }

      const attemptsBySession = new Map<string, typeof attempts>();
      for (const attempt of attempts) {
        const existing = attemptsBySession.get(attempt.sessionId) ?? [];
        existing.push(attempt);
        attemptsBySession.set(attempt.sessionId, existing);
      }
      const skillsByAttempt = new Map<string, string[]>();
      for (const event of evidence) {
        if (!event.practiceAttemptId) continue;
        const existing = skillsByAttempt.get(event.practiceAttemptId) ?? [];
        if (!existing.includes(event.skillKey)) existing.push(event.skillKey);
        skillsByAttempt.set(event.practiceAttemptId, existing);
      }

      return sessions.map((session) => {
        const sessionAttempts = attemptsBySession.get(session.id) ?? [];
        const skillKeys = sessionAttempts.flatMap((attempt) =>
          skillsByAttempt.get(attempt.id) ?? [],
        );
        const sceneTitle = session.sceneTitle;
        const sceneLabel = sceneTitle && typeof sceneTitle === "object"
          ? sceneTitle.zh ?? sceneTitle.es ?? null
          : null;
        return {
          activeSeconds: activeSecondsForEvents(
            activityBySession.get(session.id) ?? [],
          ),
          attemptCount: sessionAttempts.length,
          completedAt: session.completedAt,
          id: session.id,
          independentExpressionCount: sessionAttempts.filter(
            (attempt) =>
              attempt.modality === "speech" &&
              attempt.hintLevel === 0 &&
              Boolean(attempt.responseText?.trim()),
          ).length,
          sceneLabel,
          startedAt: session.startedAt,
          status: session.status,
          skillKeys: [...new Set(skillKeys)],
        };
      });
    },
  };
}
