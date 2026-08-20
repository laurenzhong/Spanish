// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  audioAssets,
  characterCanonFacts,
  characterRelationships,
  characters,
  communicationDomains,
  contentPackActivities,
  contentPackSegments,
  contentPacks,
  contentReviews,
  contentSources,
  conversations,
  evidenceEvents,
  expressionTags,
  expressionVariants,
  expressions,
  idempotencyKeys,
  learningBreakpoints,
  learningGoals,
  memorySharingPermissions,
  messages,
  practiceAttempts,
  practiceSessions,
  profiles,
  providerCalls,
  relationshipMemories,
  scenarioTasks,
  scenarios,
  tags,
  userPreferences,
  userSceneStates,
  userSkillStates,
} from "@/src/shared/db/schema";

const allTables = [
  profiles,
  userPreferences,
  communicationDomains,
  learningGoals,
  expressions,
  expressionVariants,
  tags,
  expressionTags,
  scenarios,
  scenarioTasks,
  contentPacks,
  contentPackSegments,
  contentPackActivities,
  contentSources,
  contentReviews,
  practiceSessions,
  practiceAttempts,
  learningBreakpoints,
  evidenceEvents,
  userSkillStates,
  userSceneStates,
  characters,
  characterCanonFacts,
  characterRelationships,
  relationshipMemories,
  memorySharingPermissions,
  conversations,
  messages,
  audioAssets,
  providerCalls,
  idempotencyKeys,
] as const;

const userOwnedTables = [
  userPreferences,
  audioAssets,
  providerCalls,
  idempotencyKeys,
  practiceSessions,
  practiceAttempts,
  learningBreakpoints,
  evidenceEvents,
  userSkillStates,
  userSceneStates,
  characterRelationships,
  relationshipMemories,
  memorySharingPermissions,
  conversations,
  messages,
] as const;

describe("database schema", () => {
  it("defines the complete ALPHA-003 first-table set", () => {
    expect(allTables.map(getTableName).sort()).toEqual(
      [
        "audio_assets",
        "character_canon_facts",
        "character_relationships",
        "characters",
        "communication_domains",
        "content_pack_activities",
        "content_pack_segments",
        "content_packs",
        "content_reviews",
        "content_sources",
        "conversations",
        "evidence_events",
        "expression_tags",
        "expression_variants",
        "expressions",
        "idempotency_keys",
        "learning_breakpoints",
        "learning_goals",
        "memory_sharing_permissions",
        "messages",
        "practice_attempts",
        "practice_sessions",
        "profiles",
        "provider_calls",
        "relationship_memories",
        "scenario_tasks",
        "scenarios",
        "tags",
        "user_preferences",
        "user_scene_states",
        "user_skill_states",
      ].sort(),
    );
  });

  it("keeps ownership and audit columns on private user tables", () => {
    for (const table of userOwnedTables) {
      const columns = getTableColumns(table);

      expect(columns, `${getTableName(table)} must have user_id`).toHaveProperty(
        "userId",
      );
      expect(columns, `${getTableName(table)} must have created_at`).toHaveProperty(
        "createdAt",
      );
      expect(columns, `${getTableName(table)} must have updated_at`).toHaveProperty(
        "updatedAt",
      );
    }
  });

  it("gives evidence events idempotency and high-value lookup indexes", () => {
    const config = getTableConfig(evidenceEvents);
    const indexNames = config.indexes.map((databaseIndex) => databaseIndex.config.name);

    expect(indexNames).toEqual(
      expect.arrayContaining([
        "evidence_events_user_idempotency_uidx",
        "evidence_events_user_occurred_idx",
        "evidence_events_user_skill_occurred_idx",
      ]),
    );
  });

  it("applies the versioned migration to an empty PostgreSQL database", async () => {
    const database = new PGlite();
    const migrationPath = path.join(
      process.cwd(),
      "drizzle",
      "0000_big_phalanx.sql",
    );
    const migration = (await readFile(migrationPath, "utf8")).replaceAll(
      "--> statement-breakpoint",
      "",
    );

    try {
      await database.exec(migration);

      const result = await database.query<{ table_name: string }>(`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_type = 'BASE TABLE'
        order by table_name
      `);

      expect(result.rows.map((row) => row.table_name)).toEqual(
        allTables.map(getTableName).sort(),
      );
    } finally {
      await database.close();
    }
  });
});
