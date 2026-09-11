import { and, desc, eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type { ScenarioSuggestionContextRepository } from "../application/suggest-scenario";
import type { ScenarioSuggestionContext } from "../domain/scenario-suggestion";

type ExploreDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

function categoryForRelationship(relationshipType: string): string {
  if (relationshipType.includes("campus")) return "study";
  if (relationshipType.includes("rental")) return "housing";
  if (relationshipType.includes("restaurant")) return "daily-life";
  return "social";
}

export function createDrizzleScenarioSuggestionContextRepository<TResult extends PgQueryResultHKT>(
  database: ExploreDatabase<TResult>,
): ScenarioSuggestionContextRepository {
  return {
    async getForUser(userId): Promise<ScenarioSuggestionContext> {
      const [savedRows, skillRows, sceneRows, sessionRows] = await Promise.all([
        database
          .select({ sourceText: schema.userSavedExpressions.sourceText })
          .from(schema.userSavedExpressions)
          .where(and(eq(schema.userSavedExpressions.userId, userId), eq(schema.userSavedExpressions.archived, false)))
          .orderBy(desc(schema.userSavedExpressions.createdAt)),
        database
          .select({ skillKey: schema.userSkillStates.skillKey, mastery: schema.userSkillStates.mastery, confidence: schema.userSkillStates.confidence, evidenceCount: schema.userSkillStates.evidenceCount })
          .from(schema.userSkillStates)
          .where(eq(schema.userSkillStates.userId, userId)),
        database
          .select({ stableKey: schema.scenarios.stableKey, relationshipType: schema.scenarios.relationshipType, evidenceCount: schema.userSceneStates.evidenceCount })
          .from(schema.userSceneStates)
          .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.userSceneStates.scenarioId))
          .where(eq(schema.userSceneStates.userId, userId)),
        database
          .select({ stableKey: schema.scenarios.stableKey, stableStatus: schema.scenarioSessionStates.stableStatus })
          .from(schema.scenarioSessionStates)
          .innerJoin(schema.practiceSessions, eq(schema.practiceSessions.id, schema.scenarioSessionStates.sessionId))
          .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.practiceSessions.scenarioId))
          .where(eq(schema.scenarioSessionStates.userId, userId))
          .orderBy(desc(schema.scenarioSessionStates.updatedAt))
          .limit(20),
      ]);

      const practicedScenes = sceneRows.filter((row) => row.evidenceCount > 0);
      const recentScenarioKeys = [...new Set(sessionRows.map((row) => row.stableKey))].slice(0, 5);
      const nonActiveStatuses = new Set(["completed", "review-pending", "review-ready"]);
      return {
        cefr: null,
        savedExpressionTexts: savedRows.map((row) => row.sourceText),
        reliableGapGoalKeys: skillRows
          .filter((row) => row.evidenceCount > 0 && row.confidence >= 0.6 && row.mastery < 0.65)
          .map((row) => row.skillKey),
        practicedScenarioKeys: practicedScenes.map((row) => row.stableKey),
        practicedCategories: [...new Set(practicedScenes.map((row) => categoryForRelationship(row.relationshipType)))],
        practicedGoalKeys: skillRows.filter((row) => row.evidenceCount > 0).map((row) => row.skillKey),
        recentScenarioKeys,
        activeScenarioKeys: [...new Set(sessionRows.filter((row) => !nonActiveStatuses.has(row.stableStatus)).map((row) => row.stableKey))],
      };
    },
  };
}
