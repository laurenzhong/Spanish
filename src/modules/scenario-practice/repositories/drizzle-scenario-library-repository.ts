import { and, desc, eq, gte, isNull, or } from "drizzle-orm";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";
import type { JsonObject } from "@/src/shared/db/schema/common";
import type { ScenarioPracticeDetail } from "../content";
import type {
  CreatePersonalScenarioInput,
  CreateSavedExpressionInput,
  GenerationSourceInput,
  PersonalScenarioRecord,
  ResolvedSavedExpression,
  SavedExpressionDto,
  SavedExpressionSourceInput,
  ScenarioLibraryRepository,
} from "./scenario-library-repository";

function localized(value: Record<string, string> | null | undefined): string | null {
  return value?.["zh-CN"] ?? value?.["zh"] ?? Object.values(value ?? {})[0] ?? null;
}

function savedDto(row: typeof schema.userSavedExpressions.$inferSelect): SavedExpressionDto {
  return { id: row.id, sourceText: row.sourceText, translation: row.translation, sourceType: row.sourceType as SavedExpressionDto["sourceType"], sourceEntityId: row.sourceEntityId, sourceVersion: row.sourceVersion, createdAt: row.createdAt.toISOString() };
}

function personalRecord(row: typeof schema.personalScenarios.$inferSelect): PersonalScenarioRecord {
  const sourceReference = row.sourceReference as JsonObject;
  return {
    id: row.id,
    userId: row.userId,
    idempotencyKey: row.idempotencyKey,
    inputFingerprint: typeof sourceReference.inputFingerprint === "string" ? sourceReference.inputFingerprint : "",
    detail: row.skeleton as unknown as ScenarioPracticeDetail,
    sourceType: row.sourceType as PersonalScenarioRecord["sourceType"],
    sourceEntityId: typeof sourceReference.sourceEntityId === "string" ? sourceReference.sourceEntityId : null,
    providerKey: row.providerKey,
    modelVersion: row.modelVersion,
    providerRequestId: typeof sourceReference.providerRequestId === "string" ? sourceReference.providerRequestId : null,
    latencyMs: typeof sourceReference.latencyMs === "number" ? sourceReference.latencyMs : 0,
    estimatedCostMicros: typeof sourceReference.estimatedCostMicros === "number" ? sourceReference.estimatedCostMicros : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createDrizzleScenarioLibraryRepository(database: Database): ScenarioLibraryRepository {
  async function resolveSavedExpressionSource(userId: string, source: SavedExpressionSourceInput): Promise<ResolvedSavedExpression | null> {
    if (source.sourceType === "manual") return { sourceText: source.text.trim(), translation: source.translation?.trim() || null, register: null, usageNotes: null, sourceType: source.sourceType, sourceEntityId: null, sourceVersion: null, expressionId: null, contentHash: null };
    if (source.sourceType === "formal-expression") {
      const [row] = await database.select().from(schema.expressions).where(and(eq(schema.expressions.stableKey, source.expressionKey), eq(schema.expressions.contentVersion, source.version))).limit(1);
      if (!row || row.status === "archived" || (process.env.NODE_ENV === "production" && row.status !== "published")) return null;
      return { sourceText: row.sourceText, translation: localized(row.translations), register: row.register, usageNotes: localized(row.usageNotes as Record<string, string>), sourceType: source.sourceType, sourceEntityId: row.stableKey, sourceVersion: String(row.contentVersion), expressionId: row.id, contentHash: null };
    }
    if (source.sourceType === "reading-selection") {
      const [row] = await database.select().from(schema.userArticleHighlights).where(and(eq(schema.userArticleHighlights.id, source.highlightId), eq(schema.userArticleHighlights.userId, userId))).limit(1);
      return row ? { sourceText: row.text, translation: null, register: null, usageNotes: null, sourceType: source.sourceType, sourceEntityId: row.id, sourceVersion: null, expressionId: null, contentHash: null } : null;
    }
    const [row] = await database.select({ review: schema.scenarioTurnReviews, turn: schema.scenarioTurns }).from(schema.scenarioTurnReviews).innerJoin(schema.scenarioTurns, and(eq(schema.scenarioTurns.id, schema.scenarioTurnReviews.turnId), eq(schema.scenarioTurns.userId, userId))).where(and(eq(schema.scenarioTurnReviews.id, source.reviewId), eq(schema.scenarioTurnReviews.userId, userId), eq(schema.scenarioTurnReviews.status, "ready"))).limit(1);
    if (!row) return null;
    return { sourceText: row.review.naturalAlternatives[0] ?? row.turn.text, translation: null, register: null, usageNotes: "来自本人已完成场景轮次的自然替代表达", sourceType: source.sourceType, sourceEntityId: row.review.id, sourceVersion: row.review.algorithmVersion, expressionId: null, contentHash: null };
  }

  return {
    async listSavedExpressions(userId) {
      const rows = await database.select().from(schema.userSavedExpressions).where(and(eq(schema.userSavedExpressions.userId, userId), eq(schema.userSavedExpressions.archived, false))).orderBy(desc(schema.userSavedExpressions.createdAt));
      return rows.map(savedDto);
    },
    resolveSavedExpressionSource,
    async findSavedExpressionByClientSaveId(userId, clientSaveId) {
      const [row] = await database.select().from(schema.userSavedExpressions).where(and(eq(schema.userSavedExpressions.userId, userId), eq(schema.userSavedExpressions.clientSaveId, clientSaveId))).limit(1);
      return row ? savedDto(row) : null;
    },
    async createSavedExpression(input: CreateSavedExpressionInput) {
      const [row] = await database.insert(schema.userSavedExpressions).values({ ...input, archived: false }).returning();
      if (!row) throw new Error("SAVED_EXPRESSION_WRITE_FAILED");
      return savedDto(row);
    },
    async archiveSavedExpression(userId, savedExpressionId) {
      const rows = await database.update(schema.userSavedExpressions).set({ archived: true, updatedAt: new Date() }).where(and(eq(schema.userSavedExpressions.userId, userId), eq(schema.userSavedExpressions.id, savedExpressionId), eq(schema.userSavedExpressions.archived, false))).returning({ id: schema.userSavedExpressions.id });
      return rows.length > 0;
    },
    async listGenerationSources(userId) {
      const [saved, highlights, reviews] = await Promise.all([
        database.select().from(schema.userSavedExpressions).where(and(eq(schema.userSavedExpressions.userId, userId), eq(schema.userSavedExpressions.archived, false))).orderBy(desc(schema.userSavedExpressions.createdAt)).limit(20),
        database.select().from(schema.userArticleHighlights).where(eq(schema.userArticleHighlights.userId, userId)).orderBy(desc(schema.userArticleHighlights.createdAt)).limit(20),
        database.select({ review: schema.scenarioTurnReviews, turn: schema.scenarioTurns }).from(schema.scenarioTurnReviews).innerJoin(schema.scenarioTurns, and(eq(schema.scenarioTurns.id, schema.scenarioTurnReviews.turnId), eq(schema.scenarioTurns.userId, userId))).where(and(eq(schema.scenarioTurnReviews.userId, userId), eq(schema.scenarioTurnReviews.status, "ready"), eq(schema.scenarioTurnReviews.communicationSuccess, false), or(isNull(schema.scenarioTurnReviews.transcriptConfidence), gte(schema.scenarioTurnReviews.transcriptConfidence, 0.6)))).orderBy(desc(schema.scenarioTurnReviews.createdAt)).limit(20),
      ]);
      return {
        savedExpressions: saved.map((row) => ({ id: row.id, label: row.sourceText, detail: row.translation })),
        readingHighlights: highlights.map((row) => ({ id: row.id, label: row.text, detail: "来自你的阅读选区" })),
        recentErrors: reviews.map((row) => ({ id: row.review.id, label: row.review.naturalAlternatives[0] ?? row.turn.text, detail: "来自已确认的近期表达问题" })),
      };
    },
    async resolveGenerationSource(userId, source: GenerationSourceInput) {
      if (source.sourceType === "topic") return { sourceType: "topic", sourceEntityId: null, topic: source.topic.trim(), expressions: [], sourceVersion: null };
      if (source.sourceType === "saved-expression") {
        const [row] = await database.select().from(schema.userSavedExpressions).where(and(eq(schema.userSavedExpressions.id, source.sourceId), eq(schema.userSavedExpressions.userId, userId), eq(schema.userSavedExpressions.archived, false))).limit(1);
        return row ? { sourceType: source.sourceType, sourceEntityId: row.id, topic: `练习使用表达：${row.sourceText}`, expressions: [{ text: row.sourceText, translation: row.translation }], sourceVersion: row.sourceVersion } : null;
      }
      if (source.sourceType === "reading") {
        const [row] = await database.select().from(schema.userArticleHighlights).where(and(eq(schema.userArticleHighlights.id, source.sourceId), eq(schema.userArticleHighlights.userId, userId))).limit(1);
        return row ? { sourceType: source.sourceType, sourceEntityId: row.id, topic: "把阅读中的表达迁移到真实沟通", expressions: [{ text: row.text, translation: null }], sourceVersion: null } : null;
      }
      const [row] = await database.select({ review: schema.scenarioTurnReviews, turn: schema.scenarioTurns }).from(schema.scenarioTurnReviews).innerJoin(schema.scenarioTurns, and(eq(schema.scenarioTurns.id, schema.scenarioTurnReviews.turnId), eq(schema.scenarioTurns.userId, userId))).where(and(eq(schema.scenarioTurnReviews.id, source.sourceId), eq(schema.scenarioTurnReviews.userId, userId), eq(schema.scenarioTurnReviews.status, "ready"), eq(schema.scenarioTurnReviews.communicationSuccess, false), or(isNull(schema.scenarioTurnReviews.transcriptConfidence), gte(schema.scenarioTurnReviews.transcriptConfidence, 0.6)))).limit(1);
      return row ? { sourceType: source.sourceType, sourceEntityId: row.review.id, topic: "在新语境中修复近期确认过的表达问题", expressions: row.review.naturalAlternatives.map((text) => ({ text, translation: null })), sourceVersion: row.review.algorithmVersion } : null;
    },
    async findPersonalScenarioByIdempotencyKey(userId, idempotencyKey) {
      const [row] = await database.select().from(schema.personalScenarios).where(and(eq(schema.personalScenarios.userId, userId), eq(schema.personalScenarios.idempotencyKey, idempotencyKey))).limit(1);
      return row ? personalRecord(row) : null;
    },
    async createPersonalScenario(input: CreatePersonalScenarioInput) {
      const [row] = await database.insert(schema.personalScenarios).values({
        id: input.id, userId: input.userId, idempotencyKey: input.idempotencyKey, title: input.detail.title, cefr: input.detail.cefr, region: input.detail.temporaryCharacter.locale,
        skeleton: input.detail as unknown as JsonObject, sourceType: input.sourceType,
        sourceReference: { inputFingerprint: input.inputFingerprint, sourceEntityId: input.sourceEntityId, providerRequestId: input.providerRequestId, latencyMs: input.latencyMs, estimatedCostMicros: input.estimatedCostMicros },
        sourceVersion: "1", selectedExpressions: input.detail.expressions.map((item) => item.text), communicationGoals: input.detail.tasks.map((item) => item.prompt), conditionChanges: input.detail.conditions.map((item) => item.prompt),
        providerKey: input.providerKey, modelVersion: input.modelVersion, generationVersion: "personal-scenario-v1", status: "ready",
      }).returning();
      if (!row) throw new Error("PERSONAL_SCENARIO_WRITE_FAILED");
      return personalRecord(row);
    },
    async getPersonalScenario(userId, personalScenarioId) {
      const [row] = await database.select().from(schema.personalScenarios).where(and(eq(schema.personalScenarios.id, personalScenarioId), eq(schema.personalScenarios.userId, userId), eq(schema.personalScenarios.status, "ready"))).limit(1);
      return row ? personalRecord(row) : null;
    },
    async archivePersonalScenario(userId, personalScenarioId) {
      const rows = await database.update(schema.personalScenarios).set({ status: "archived", updatedAt: new Date() }).where(and(eq(schema.personalScenarios.id, personalScenarioId), eq(schema.personalScenarios.userId, userId), eq(schema.personalScenarios.status, "ready"))).returning({ id: schema.personalScenarios.id });
      return rows.length > 0;
    },
    async listPersonalSuggestionCandidates(userId) {
      const rows = await database.select().from(schema.personalScenarios).where(and(eq(schema.personalScenarios.userId, userId), eq(schema.personalScenarios.status, "ready"))).orderBy(desc(schema.personalScenarios.createdAt));
      return rows.flatMap((row) => {
        const detail = row.skeleton as unknown as ScenarioPracticeDetail;
        if (!detail.tasks?.length || !detail.expressions?.length || !detail.temporaryCharacter?.displayName) return [];
        return [{ id: row.id, title: detail.title, description: detail.description, cefr: detail.cefr as "A1" | "A2" | "B1" | "B2", region: detail.temporaryCharacter.locale, role: detail.temporaryCharacter.role, communicationGoal: detail.tasks[0]!.prompt, goalKeys: detail.tasks.map((task) => task.goalKey), expressionTexts: detail.expressions.flatMap((item) => [item.text, ...item.variants]) }];
      });
    },
  };
}
