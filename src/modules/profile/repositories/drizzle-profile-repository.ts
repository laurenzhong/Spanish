import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

import type { ProfileRepository } from "./profile-repository";

type ProfileDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof schema
>;

export function createDrizzleProfileRepository<
  TResult extends PgQueryResultHKT,
>(database: ProfileDatabase<TResult>): ProfileRepository {
  return {
    async listEvidence(userId) {
      const rows = await database
        .select({
          occurredAt: schema.evidenceEvents.occurredAt,
          skillKey: schema.evidenceEvents.skillKey,
          modality: schema.evidenceEvents.modality,
        })
        .from(schema.evidenceEvents)
        .where(eq(schema.evidenceEvents.userId, userId))
        .orderBy(desc(schema.evidenceEvents.occurredAt));

      return rows;
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
