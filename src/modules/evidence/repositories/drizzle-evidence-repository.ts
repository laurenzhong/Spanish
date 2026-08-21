import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  evidenceEvents,
  practiceAttempts,
  userSkillStates,
} from "@/src/shared/db/schema";
import * as databaseSchema from "@/src/shared/db/schema";

import type { SkillStateSnapshot } from "@/src/modules/profile/domain";
import type {
  EvidenceRepository,
  PersistedEvidenceEvent,
} from "./evidence-repository";

type EvidenceDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof databaseSchema
>;

function toEvidenceEvent(
  row: typeof evidenceEvents.$inferSelect,
): PersistedEvidenceEvent {
  return {
    algorithmVersion: row.algorithmVersion,
    confidence: row.confidence,
    contentVersion: row.contentVersion,
    evidenceWeight: row.evidenceWeight,
    idempotencyKey: row.idempotencyKey,
    modality: row.modality,
    occurredAt: row.occurredAt,
    outcomeScore: row.outcomeScore,
    practiceAttemptId: row.practiceAttemptId,
    skillKey: row.skillKey,
    sourceReference: row.sourceReference ?? {},
    sourceType: row.sourceType,
    userId: row.userId,
  };
}

export function createDrizzleEvidenceRepository<
  TResult extends PgQueryResultHKT,
>(database: EvidenceDatabase<TResult>): EvidenceRepository {
  return {
    async assertPracticeAttemptBelongsToUser(userId, practiceAttemptId) {
      const [attempt] = await database
        .select({ id: practiceAttempts.id })
        .from(practiceAttempts)
        .where(
          and(
            eq(practiceAttempts.id, practiceAttemptId),
            eq(practiceAttempts.userId, userId),
          ),
        )
        .limit(1);
      return Boolean(attempt);
    },

    async append(events) {
      if (events.length === 0) return;
      await database
        .insert(evidenceEvents)
        .values(
          events.map((event) => ({
            algorithmVersion: event.algorithmVersion,
            confidence: event.confidence,
            contentVersion: event.contentVersion,
            evidenceWeight: event.evidenceWeight,
            idempotencyKey: event.idempotencyKey,
            modality: event.modality,
            occurredAt: event.occurredAt,
            outcomeScore: event.outcomeScore,
            practiceAttemptId: event.practiceAttemptId,
            skillKey: event.skillKey,
            sourceReference: event.sourceReference,
            sourceType: event.sourceType,
            userId: event.userId,
          })),
        )
        .onConflictDoNothing({
          target: [evidenceEvents.userId, evidenceEvents.idempotencyKey],
        });
    },

    async findByIdempotencyKeys(userId, idempotencyKeys) {
      if (idempotencyKeys.length === 0) return [];
      const rows = await database
        .select()
        .from(evidenceEvents)
        .where(
          and(
            eq(evidenceEvents.userId, userId),
            inArray(evidenceEvents.idempotencyKey, idempotencyKeys),
          ),
        );
      return rows.map(toEvidenceEvent);
    },

    async listBySkill(userId, skillKey) {
      const rows = await database
        .select()
        .from(evidenceEvents)
        .where(
          and(
            eq(evidenceEvents.userId, userId),
            eq(evidenceEvents.skillKey, skillKey),
          ),
        );
      return rows.map(toEvidenceEvent);
    },

    async transaction(work) {
      return database.transaction((transaction) =>
        work(createDrizzleEvidenceRepository(transaction)),
      );
    },

    async upsertSkillState(state: SkillStateSnapshot) {
      await database
        .insert(userSkillStates)
        .values({
          confidence: state.confidence,
          evidenceCount: state.evidenceCount,
          lastEvidenceAt: state.lastEvidenceAt,
          mastery: state.mastery,
          skillKey: state.skillKey,
          snapshotVersion: state.snapshotVersion,
          userId: state.userId,
        })
        .onConflictDoUpdate({
          target: [userSkillStates.userId, userSkillStates.skillKey],
          set: {
            confidence: state.confidence,
            evidenceCount: state.evidenceCount,
            lastEvidenceAt: state.lastEvidenceAt,
            mastery: state.mastery,
            snapshotVersion: state.snapshotVersion,
            updatedAt: new Date(),
          },
        });
    },
  };
}
