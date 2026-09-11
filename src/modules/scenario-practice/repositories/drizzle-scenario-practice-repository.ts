import { and, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

import type { ScenarioTurn, TemporaryCharacterSnapshot } from "../domain";
import type {
  AppendScenarioTurnInput,
  PersistedScenarioSession,
  ScenarioPracticeRepository,
} from "./scenario-practice-repository";

type ScenarioDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

function projectSession(
  row: typeof schema.scenarioSessionStates.$inferSelect & {
    scenarioId: string | null;
    primaryModality: "speech" | "typing" | "listening" | "reading";
    contentVersion: number;
  },
): PersistedScenarioSession {
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    clientAttemptId: row.clientAttemptId,
    personalScenarioId: row.personalScenarioId,
    scenarioId: row.scenarioId,
    primaryModality: row.primaryModality as PersistedScenarioSession["primaryModality"],
    contentVersion: row.contentVersion,
    status: row.stableStatus,
    revision: row.revision,
    currentTurn: row.currentTurn,
    hintLevel: row.hintLevel as 0 | 1 | 2 | 3,
    generationId: row.generationId,
    communicationGoal: row.communicationGoal,
    temporaryCharacter: row.temporaryCharacter as TemporaryCharacterSnapshot,
    reviewStatus: row.reviewStatus as PersistedScenarioSession["reviewStatus"],
    completionIdempotencyKey: row.completionIdempotencyKey,
  };
}

function projectTurn(row: typeof schema.scenarioTurns.$inferSelect): ScenarioTurn {
  return {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    turnIndex: row.turnIndex,
    speaker: row.speaker as ScenarioTurn["speaker"],
    modality: row.modality as ScenarioTurn["modality"],
    text: row.text,
    status: row.status as ScenarioTurn["status"],
    attemptId: row.attemptId,
    generationId: row.generationId,
  };
}

export function createDrizzleScenarioPracticeRepository<TResult extends PgQueryResultHKT>(
  database: ScenarioDatabase<TResult>,
): ScenarioPracticeRepository {
  async function selectSession(userId: string, sessionId: string) {
    const [row] = await database
      .select({
        session: schema.scenarioSessionStates,
        scenarioId: schema.practiceSessions.scenarioId,
        primaryModality: schema.practiceSessions.primaryModality,
        contentVersion: schema.practiceSessions.contentVersion,
      })
      .from(schema.scenarioSessionStates)
      .innerJoin(schema.practiceSessions, eq(schema.practiceSessions.id, schema.scenarioSessionStates.sessionId))
      .where(and(eq(schema.scenarioSessionStates.userId, userId), eq(schema.scenarioSessionStates.sessionId, sessionId)))
      .limit(1);
    return row ? projectSession({
      ...row.session,
      scenarioId: row.scenarioId,
      primaryModality: row.primaryModality,
      contentVersion: row.contentVersion,
    }) : null;
  }

  async function selectTurn(userId: string, clientAttemptId: string) {
    const [row] = await database
      .select()
      .from(schema.scenarioTurns)
      .where(and(eq(schema.scenarioTurns.userId, userId), eq(schema.scenarioTurns.clientAttemptId, clientAttemptId)))
      .limit(1);
    return row ?? null;
  }

  async function appendCompletedTurn(input: AppendScenarioTurnInput) {
    if (!input.text.trim()) throw new Error("SCENARIO_TURN_CONFLICT");
    const session = await selectSession(input.userId, input.sessionId);
    if (!session) throw new Error("SCENARIO_SESSION_NOT_FOUND");
    const [inserted] = await database
      .insert(schema.scenarioTurns)
      .values({
        id: input.id,
        userId: input.userId,
        sessionId: input.sessionId,
        clientAttemptId: input.clientAttemptId,
        turnIndex: input.turnIndex,
        speaker: input.speaker,
        modality: input.modality,
        text: input.text.trim(),
        status: "completed",
        attemptId: input.attemptId ?? null,
        generationId: input.generationId ?? null,
        replyToTurnId: input.replyToTurnId ?? null,
        providerKey: input.providerKey ?? null,
        modelVersion: input.modelVersion ?? null,
        providerRequestId: input.providerRequestId ?? null,
        completedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [schema.scenarioTurns.userId, schema.scenarioTurns.clientAttemptId],
      })
      .returning();
    if (inserted) return projectTurn(inserted);
    const existing = await selectTurn(input.userId, input.clientAttemptId);
    if (
      !existing ||
      existing.sessionId !== input.sessionId ||
      existing.turnIndex !== input.turnIndex ||
      existing.speaker !== input.speaker ||
      existing.text !== input.text.trim()
    ) {
      throw new Error("SCENARIO_TURN_CONFLICT");
    }
    return projectTurn(existing);
  }

  return {
    async createSession(input) {
      const existing = await database
        .select({ sessionId: schema.scenarioSessionStates.sessionId })
        .from(schema.scenarioSessionStates)
        .where(and(
          eq(schema.scenarioSessionStates.userId, input.userId),
          eq(schema.scenarioSessionStates.clientAttemptId, input.clientAttemptId),
        ))
        .limit(1);
      if (existing[0]) {
        const found = await selectSession(input.userId, existing[0].sessionId);
        if (!found) throw new Error("SCENARIO_SESSION_NOT_FOUND");
        const sameCharacter = found.temporaryCharacter.displayName === input.temporaryCharacter.displayName &&
          found.temporaryCharacter.role === input.temporaryCharacter.role &&
          found.temporaryCharacter.locale === input.temporaryCharacter.locale;
        if (
          found.scenarioId !== (input.scenarioId ?? null) ||
          found.personalScenarioId !== (input.personalScenarioId ?? null) ||
          found.primaryModality !== input.primaryModality ||
          found.contentVersion !== input.contentVersion ||
          found.communicationGoal !== input.communicationGoal ||
          !sameCharacter
        ) {
          throw new Error("SCENARIO_SESSION_CONFLICT");
        }
        return found;
      }

      return database.transaction(async (transaction) => {
        await transaction.insert(schema.practiceSessions).values({
          id: input.sessionId,
          userId: input.userId,
          scenarioId: input.scenarioId ?? null,
          primaryModality: input.primaryModality,
          contentVersion: input.contentVersion,
        });
        const [inserted] = await transaction.insert(schema.scenarioSessionStates).values({
          sessionId: input.sessionId,
          userId: input.userId,
          personalScenarioId: input.personalScenarioId ?? null,
          clientAttemptId: input.clientAttemptId,
          temporaryCharacter: input.temporaryCharacter,
          communicationGoal: input.communicationGoal,
        }).onConflictDoNothing({
          target: [schema.scenarioSessionStates.userId, schema.scenarioSessionStates.clientAttemptId],
        }).returning();
        if (!inserted) throw new Error("SCENARIO_SESSION_CONFLICT");
        return projectSession({
          ...inserted,
          scenarioId: input.scenarioId ?? null,
          primaryModality: input.primaryModality,
          contentVersion: input.contentVersion,
        });
      });
    },

    getSession: selectSession,

    async compareAndSwapState(input) {
      const [updated] = await database
        .update(schema.scenarioSessionStates)
        .set({
          stableStatus: input.status,
          ...(input.generationId === undefined ? {} : { generationId: input.generationId }),
          ...(input.hintLevel === undefined ? {} : { hintLevel: input.hintLevel }),
          ...(input.currentTurn === undefined ? {} : { currentTurn: input.currentTurn }),
          ...(input.reviewStatus === undefined ? {} : { reviewStatus: input.reviewStatus }),
          ...(input.completedAt === undefined ? {} : { completedAt: input.completedAt }),
          revision: input.expectedRevision + 1,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schema.scenarioSessionStates.userId, input.userId),
          eq(schema.scenarioSessionStates.sessionId, input.sessionId),
          eq(schema.scenarioSessionStates.revision, input.expectedRevision),
        ))
        .returning();
      if (!updated) {
        if (await selectSession(input.userId, input.sessionId)) {
          throw new Error("SCENARIO_SESSION_CONFLICT");
        }
        throw new Error("SCENARIO_SESSION_NOT_FOUND");
      }
      const base = await database
        .select({
          scenarioId: schema.practiceSessions.scenarioId,
          primaryModality: schema.practiceSessions.primaryModality,
          contentVersion: schema.practiceSessions.contentVersion,
        })
        .from(schema.practiceSessions)
        .where(eq(schema.practiceSessions.id, input.sessionId))
        .limit(1);
      if (!base[0]) throw new Error("SCENARIO_SESSION_NOT_FOUND");
      return projectSession({
        ...updated,
        scenarioId: base[0].scenarioId,
        primaryModality: base[0].primaryModality,
        contentVersion: base[0].contentVersion,
      });
    },

    appendCompletedUserTurn(input) {
      return appendCompletedTurn(input);
    },

    appendCompletedRoleplayTurn(input) {
      if (!input.done) throw new Error("SCENARIO_REPLY_INCOMPLETE");
      return appendCompletedTurn(input);
    },

    async createRepetitionItems(items) {
      if (items.length === 0) return 0;
      const rows = await database
        .insert(schema.scenarioRepetitionItems)
        .values(items.map((item) => ({
          id: item.id,
          userId: item.userId,
          sourceSessionId: item.sourceSessionId,
          expressionSnapshot: [...item.expressionSnapshot],
          goalSnapshot: item.goalSnapshot,
          dueAt: item.dueAt,
          intervalStep: item.intervalStep,
          status: item.status,
          lastResult: item.result,
          variantRequirements: item.variantRequirements.map((entry) => ({ ...entry })),
          idempotencyKey: item.idempotencyKey,
          completionKey: item.completionKey,
          completedAt: item.completedAt,
        })))
        .onConflictDoNothing()
        .returning({ id: schema.scenarioRepetitionItems.id });
      return rows.length;
    },

    async completeSession(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction
          .select({
            session: schema.scenarioSessionStates,
            scenarioId: schema.practiceSessions.scenarioId,
            primaryModality: schema.practiceSessions.primaryModality,
            contentVersion: schema.practiceSessions.contentVersion,
          })
          .from(schema.scenarioSessionStates)
          .innerJoin(schema.practiceSessions, eq(schema.practiceSessions.id, schema.scenarioSessionStates.sessionId))
          .where(and(
            eq(schema.scenarioSessionStates.userId, input.userId),
            eq(schema.scenarioSessionStates.sessionId, input.sessionId),
          ))
          .limit(1);
        if (!current) throw new Error("SCENARIO_SESSION_NOT_FOUND");
        if (current.session.completionIdempotencyKey) {
          if (current.session.completionIdempotencyKey !== input.idempotencyKey) {
            throw new Error("SCENARIO_SESSION_CONFLICT");
          }
          return projectSession({
            ...current.session,
            scenarioId: current.scenarioId,
            primaryModality: current.primaryModality,
            contentVersion: current.contentVersion,
          });
        }
        if (current.session.revision !== input.expectedRevision) {
          throw new Error("SCENARIO_SESSION_CONFLICT");
        }
        const [updated] = await transaction
          .update(schema.scenarioSessionStates)
          .set({
            stableStatus: "completed",
            reviewStatus: "pending",
            completionIdempotencyKey: input.idempotencyKey,
            completedAt: input.completedAt,
            revision: input.expectedRevision + 1,
            updatedAt: input.completedAt,
          })
          .where(and(
            eq(schema.scenarioSessionStates.userId, input.userId),
            eq(schema.scenarioSessionStates.sessionId, input.sessionId),
            eq(schema.scenarioSessionStates.revision, input.expectedRevision),
          ))
          .returning();
        if (!updated) throw new Error("SCENARIO_SESSION_CONFLICT");
        await transaction
          .update(schema.practiceSessions)
          .set({ status: "completed", completedAt: input.completedAt, updatedAt: input.completedAt })
          .where(and(eq(schema.practiceSessions.id, input.sessionId), eq(schema.practiceSessions.userId, input.userId)));
        if (input.repetitionItems.length > 0) {
          await transaction
            .insert(schema.scenarioRepetitionItems)
            .values(input.repetitionItems.map((item) => ({
              id: item.id,
              userId: item.userId,
              sourceSessionId: item.sourceSessionId,
              expressionSnapshot: [...item.expressionSnapshot],
              goalSnapshot: item.goalSnapshot,
              dueAt: item.dueAt,
              intervalStep: item.intervalStep,
              status: item.status,
              lastResult: item.result,
              variantRequirements: item.variantRequirements.map((entry) => ({ ...entry })),
              idempotencyKey: item.idempotencyKey,
              completionKey: item.completionKey,
              completedAt: item.completedAt,
            })))
            .onConflictDoNothing();
        }
        const [practice] = await transaction
          .select({
            scenarioId: schema.practiceSessions.scenarioId,
            primaryModality: schema.practiceSessions.primaryModality,
            contentVersion: schema.practiceSessions.contentVersion,
          })
          .from(schema.practiceSessions)
          .where(eq(schema.practiceSessions.id, input.sessionId))
          .limit(1);
        if (!practice) throw new Error("SCENARIO_SESSION_NOT_FOUND");
        return projectSession({
          ...updated,
          scenarioId: practice.scenarioId,
          primaryModality: practice.primaryModality,
          contentVersion: practice.contentVersion,
        });
      });
    },
  };
}
