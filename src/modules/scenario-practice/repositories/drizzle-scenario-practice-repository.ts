import { and, asc, desc, eq, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";

import type { ScenarioRepetitionItem, ScenarioTurn, ScenarioTurnReview, TemporaryCharacterSnapshot } from "../domain";
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
    scenarioKey?: string | null;
    scenarioTitle?: string | null;
  },
): PersistedScenarioSession {
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    clientAttemptId: row.clientAttemptId,
    personalScenarioId: row.personalScenarioId,
    scenarioId: row.scenarioId,
    scenarioKey: row.scenarioKey ?? (row.personalScenarioId ? `personal.${row.personalScenarioId}` : null),
    scenarioTitle: row.scenarioTitle ?? null,
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
    completedAt: row.completedAt,
  };
}

function localizedTitle(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const titles = value as Record<string, unknown>;
  const title = titles["zh-CN"] ?? titles.zh ?? Object.values(titles)[0];
  return typeof title === "string" ? title : null;
}

function personalTitle(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const title = (value as Record<string, unknown>).title;
  return typeof title === "string" ? title : null;
}

function projectRepetition(row: typeof schema.scenarioRepetitionItems.$inferSelect): ScenarioRepetitionItem {
  const intervalDays = [0, 1, 3, 7][row.intervalStep];
  if (intervalDays === undefined) throw new Error("SCENARIO_REPETITION_INVALID");
  return {
    id: row.id,
    userId: row.userId,
    sourceSessionId: row.sourceSessionId,
    intervalStep: row.intervalStep as 0 | 1 | 2 | 3,
    intervalDays: intervalDays as 0 | 1 | 3 | 7,
    dueAt: row.dueAt,
    status: row.status as ScenarioRepetitionItem["status"],
    expressionSnapshot: row.expressionSnapshot,
    goalSnapshot: row.goalSnapshot,
    variantRequirements: row.variantRequirements.flatMap((value) => {
      const kind = typeof value.kind === "string" ? value.kind : null;
      const requirementValue = typeof value.value === "string" ? value.value : undefined;
      return kind ? [{ kind, ...(requirementValue ? { value: requirementValue } : {}) }] : [];
    }),
    idempotencyKey: row.idempotencyKey,
    completionKey: row.completionKey,
    completedAt: row.completedAt,
    result: row.lastResult as ScenarioRepetitionItem["result"],
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

function projectReview(row: typeof schema.scenarioTurnReviews.$inferSelect): ScenarioTurnReview {
  return {
    id: row.id,
    turnId: row.turnId,
    userId: row.userId,
    communicationSuccess: row.communicationSuccess,
    errorSpans: row.errorSpans,
    naturalAlternatives: row.naturalAlternatives,
    hintLevel: row.hintLevel as 0 | 1 | 2 | 3,
    transcriptConfidence: row.transcriptConfidence,
    status: row.status as ScenarioTurnReview["status"],
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
        scenarioKey: schema.scenarios.stableKey,
        scenarioTitle: schema.scenarios.title,
        personalSkeleton: schema.personalScenarios.skeleton,
      })
      .from(schema.scenarioSessionStates)
      .innerJoin(schema.practiceSessions, eq(schema.practiceSessions.id, schema.scenarioSessionStates.sessionId))
      .leftJoin(schema.scenarios, eq(schema.scenarios.id, schema.practiceSessions.scenarioId))
      .leftJoin(schema.personalScenarios, eq(schema.personalScenarios.id, schema.scenarioSessionStates.personalScenarioId))
      .where(and(eq(schema.scenarioSessionStates.userId, userId), eq(schema.scenarioSessionStates.sessionId, sessionId)))
      .limit(1);
    return row ? projectSession({
      ...row.session,
      scenarioId: row.scenarioId,
      primaryModality: row.primaryModality,
      contentVersion: row.contentVersion,
      scenarioKey: row.scenarioKey ?? (row.session.personalScenarioId ? `personal.${row.session.personalScenarioId}` : null),
      scenarioTitle: localizedTitle(row.scenarioTitle) ?? personalTitle(row.personalSkeleton),
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

  async function syncSessionReviewStatus(turnId: string, userId: string) {
    const [turn] = await database.select({ sessionId: schema.scenarioTurns.sessionId }).from(schema.scenarioTurns)
      .where(and(eq(schema.scenarioTurns.id, turnId), eq(schema.scenarioTurns.userId, userId))).limit(1);
    if (!turn) return;
    const [remaining] = await database.select({ count: sql<number>`count(*)` }).from(schema.scenarioTurns)
      .leftJoin(schema.scenarioTurnReviews, eq(schema.scenarioTurnReviews.turnId, schema.scenarioTurns.id))
      .where(and(
        eq(schema.scenarioTurns.userId, userId),
        eq(schema.scenarioTurns.sessionId, turn.sessionId),
        eq(schema.scenarioTurns.speaker, "user"),
        eq(schema.scenarioTurns.status, "completed"),
        or(isNull(schema.scenarioTurnReviews.id), ne(schema.scenarioTurnReviews.status, "ready")),
      ));
    if (Number(remaining?.count ?? 0) === 0) {
      await database.update(schema.scenarioSessionStates).set({ reviewStatus: "ready", updatedAt: new Date() })
        .where(and(eq(schema.scenarioSessionStates.sessionId, turn.sessionId), eq(schema.scenarioSessionStates.userId, userId)));
    }
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

    async getTurn(userId, sessionId, turnId) {
      const [row] = await database.select().from(schema.scenarioTurns).where(and(
        eq(schema.scenarioTurns.userId, userId),
        eq(schema.scenarioTurns.sessionId, sessionId),
        eq(schema.scenarioTurns.id, turnId),
      )).limit(1);
      return row ? projectTurn(row) : null;
    },

    async listTurns(userId, sessionId) {
      const rows = await database.select().from(schema.scenarioTurns)
        .where(and(eq(schema.scenarioTurns.userId, userId), eq(schema.scenarioTurns.sessionId, sessionId)))
        .orderBy(asc(schema.scenarioTurns.turnIndex));
      return rows.map(projectTurn);
    },

    async listTurnReviews(userId, sessionId) {
      const rows = await database.select({ review: schema.scenarioTurnReviews })
        .from(schema.scenarioTurnReviews)
        .innerJoin(schema.scenarioTurns, eq(schema.scenarioTurns.id, schema.scenarioTurnReviews.turnId))
        .where(and(eq(schema.scenarioTurnReviews.userId, userId), eq(schema.scenarioTurns.sessionId, sessionId)))
        .orderBy(asc(schema.scenarioTurns.turnIndex));
      return rows.map((row) => projectReview(row.review));
    },

    async listHistory(userId, limit, before) {
      const conditions = [
        eq(schema.scenarioSessionStates.userId, userId),
        eq(schema.scenarioSessionStates.stableStatus, "completed"),
        isNotNull(schema.scenarioSessionStates.completedAt),
      ];
      if (before) conditions.push(lt(schema.scenarioSessionStates.completedAt, before));
      const rows = await database.select({
        session: schema.scenarioSessionStates,
        primaryModality: schema.practiceSessions.primaryModality,
        scenarioKey: schema.scenarios.stableKey,
        scenarioTitle: schema.scenarios.title,
        personalSkeleton: schema.personalScenarios.skeleton,
        userTurnCount: sql<number>`(select count(*) from ${schema.scenarioTurns} t where t.session_id = ${schema.scenarioSessionStates.sessionId} and t.user_id = ${userId} and t.speaker = 'user' and t.status = 'completed')`,
      }).from(schema.scenarioSessionStates)
        .innerJoin(schema.practiceSessions, eq(schema.practiceSessions.id, schema.scenarioSessionStates.sessionId))
        .leftJoin(schema.scenarios, eq(schema.scenarios.id, schema.practiceSessions.scenarioId))
        .leftJoin(schema.personalScenarios, eq(schema.personalScenarios.id, schema.scenarioSessionStates.personalScenarioId))
        .where(and(...conditions))
        .orderBy(desc(schema.scenarioSessionStates.completedAt), desc(schema.scenarioSessionStates.sessionId))
        .limit(limit);
      return rows.map((row) => ({
        sessionId: row.session.sessionId,
        scenarioKey: row.scenarioKey ?? (row.session.personalScenarioId ? `personal.${row.session.personalScenarioId}` : null),
        title: localizedTitle(row.scenarioTitle) ?? personalTitle(row.personalSkeleton) ?? row.session.communicationGoal,
        communicationGoal: row.session.communicationGoal,
        temporaryCharacterName: (row.session.temporaryCharacter as TemporaryCharacterSnapshot).displayName,
        primaryModality: row.primaryModality as "speech" | "typing",
        reviewStatus: row.session.reviewStatus as PersistedScenarioSession["reviewStatus"],
        completedAt: row.session.completedAt!,
        userTurnCount: Number(row.userTurnCount),
      }));
    },

    async listRepetitionItems(userId, sourceSessionId) {
      const rows = await database.select().from(schema.scenarioRepetitionItems)
        .where(and(eq(schema.scenarioRepetitionItems.userId, userId), eq(schema.scenarioRepetitionItems.sourceSessionId, sourceSessionId)))
        .orderBy(asc(schema.scenarioRepetitionItems.intervalStep));
      return rows.map(projectRepetition);
    },

    async listDueRepetitionItems(userId, dueAt, limit) {
      const rows = await database.select().from(schema.scenarioRepetitionItems)
        .where(and(eq(schema.scenarioRepetitionItems.userId, userId), eq(schema.scenarioRepetitionItems.status, "pending"), lte(schema.scenarioRepetitionItems.dueAt, dueAt)))
        .orderBy(asc(schema.scenarioRepetitionItems.dueAt), asc(schema.scenarioRepetitionItems.intervalStep))
        .limit(limit);
      return rows.map(projectRepetition);
    },

    async getRepetitionItem(userId, repetitionId) {
      const [row] = await database.select().from(schema.scenarioRepetitionItems)
        .where(and(eq(schema.scenarioRepetitionItems.userId, userId), eq(schema.scenarioRepetitionItems.id, repetitionId))).limit(1);
      return row ? projectRepetition(row) : null;
    },

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

    appendCompletedConditionTurn(input) {
      return appendCompletedTurn(input);
    },

    async saveTurnReview(input) {
      const [existing] = await database.select().from(schema.scenarioTurnReviews).where(and(
        eq(schema.scenarioTurnReviews.userId, input.userId),
        eq(schema.scenarioTurnReviews.turnId, input.turnId),
      )).limit(1);
      if (existing?.status === "ready") {
        await syncSessionReviewStatus(input.turnId, input.userId);
        return projectReview(existing);
      }
      const reviewValues = {
        communicationSuccess: input.communicationSuccess,
        errorSpans: input.errorSpans.map((span) => ({ ...span })),
        naturalAlternatives: [...input.naturalAlternatives],
        hintLevel: input.hintLevel,
        transcriptConfidence: input.transcriptConfidence,
        algorithmVersion: input.algorithmVersion,
        providerKey: input.providerKey,
        modelVersion: input.modelVersion,
        providerRequestId: input.providerRequestId,
        status: input.status,
        updatedAt: new Date(),
      };
      const [row] = await database.insert(schema.scenarioTurnReviews).values({
        id: input.id, userId: input.userId, turnId: input.turnId, ...reviewValues,
      })
        .onConflictDoUpdate({ target: schema.scenarioTurnReviews.turnId, set: reviewValues })
        .returning();
      if (!row) throw new Error("SCENARIO_REVIEW_PENDING");
      if (row.status === "ready") await syncSessionReviewStatus(input.turnId, input.userId);
      return projectReview(row);
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

    async completeRepetitionItem(userId, repetitionId, input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(schema.scenarioRepetitionItems)
          .where(and(eq(schema.scenarioRepetitionItems.userId, userId), eq(schema.scenarioRepetitionItems.id, repetitionId))).limit(1);
        if (!current) throw new Error("SCENARIO_REPETITION_NOT_FOUND");
        if (current.status === "completed") {
          if (current.completionKey !== input.completionKey) throw new Error("SCENARIO_TURN_CONFLICT");
          return projectRepetition(current);
        }
        const [updated] = await transaction.update(schema.scenarioRepetitionItems).set({
          status: "completed", completionKey: input.completionKey, completedAt: input.completedAt,
          lastResult: input.result, updatedAt: input.completedAt,
        }).where(and(eq(schema.scenarioRepetitionItems.userId, userId), eq(schema.scenarioRepetitionItems.id, repetitionId), eq(schema.scenarioRepetitionItems.status, "pending"))).returning();
        if (!updated) throw new Error("SCENARIO_TURN_CONFLICT");
        return projectRepetition(updated);
      });
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
        const completedUserTurns = await transaction.select({ id: schema.scenarioTurns.id }).from(schema.scenarioTurns)
          .where(and(eq(schema.scenarioTurns.userId, input.userId), eq(schema.scenarioTurns.sessionId, input.sessionId), eq(schema.scenarioTurns.speaker, "user"), eq(schema.scenarioTurns.status, "completed")));
        if (completedUserTurns.length > 0) {
          await transaction.insert(schema.scenarioTurnReviews).values(completedUserTurns.map((turn) => ({
            userId: input.userId,
            turnId: turn.id,
            communicationSuccess: null,
            errorSpans: [],
            naturalAlternatives: [],
            algorithmVersion: "scenario-evaluation-v1",
            status: "pending",
          }))).onConflictDoNothing({ target: schema.scenarioTurnReviews.turnId });
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
