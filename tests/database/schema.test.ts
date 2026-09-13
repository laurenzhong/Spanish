// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  acquisitionRuns,
  acquisitionSources,
  articleAssets,
  articleSegments,
  articleSources,
  articleVersions,
  articles,
  audioAssets,
  candidateArtifacts,
  candidateProcessingAttempts,
  candidateReviews,
  characterCanonFacts,
  characterIntroductionOffers,
  characterRelationships,
  characters,
  communicationDomains,
  contentBundleImports,
  contentCandidates,
  contentPackActivities,
  contentPackSegments,
  contentPacks,
  contentReviews,
  contentSources,
  conversations,
  diagnosticEvents,
  evidenceEvents,
  expressionTags,
  expressionVariants,
  expressions,
  idempotencyKeys,
  learningBreakpoints,
  learningGoals,
  mediaAssets,
  mediaItems,
  mediaSegments,
  mediaVersions,
  memorySharingPermissions,
  messages,
  practiceAttempts,
  practiceSessionActivityEvents,
  practiceSessions,
  profiles,
  providerCalls,
  privacyCleanupTasks,
  relationshipMemories,
  scenarioTasks,
  scenarios,
  tags,
  userPreferences,
  userArticleHighlights,
  userArticleSaves,
  userContentPackStates,
  userMediaProgress,
  userReadingProgress,
  userSavedArticleSources,
  userSceneStates,
  userSkillStates,
} from "@/src/shared/db/schema";

const allTables = [
  acquisitionSources,
  acquisitionRuns,
  contentCandidates,
  candidateArtifacts,
  candidateProcessingAttempts,
  candidateReviews,
  profiles,
  userPreferences,
  communicationDomains,
  contentBundleImports,
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
  practiceSessionActivityEvents,
  learningBreakpoints,
  evidenceEvents,
  userSkillStates,
  userSceneStates,
  characters,
  characterCanonFacts,
  characterIntroductionOffers,
  characterRelationships,
  relationshipMemories,
  memorySharingPermissions,
  conversations,
  messages,
  audioAssets,
  articleAssets,
  articleSegments,
  articleSources,
  articleVersions,
  articles,
  mediaItems,
  mediaVersions,
  mediaAssets,
  mediaSegments,
  providerCalls,
  diagnosticEvents,
  privacyCleanupTasks,
  idempotencyKeys,
  userReadingProgress,
  userArticleSaves,
  userArticleHighlights,
  userSavedArticleSources,
  userMediaProgress,
] as const;

const userOwnedTables = [
  userPreferences,
  audioAssets,
  providerCalls,
  idempotencyKeys,
  practiceSessions,
  practiceAttempts,
  practiceSessionActivityEvents,
  learningBreakpoints,
  evidenceEvents,
  userSkillStates,
  userSceneStates,
  characterRelationships,
  characterIntroductionOffers,
  relationshipMemories,
  memorySharingPermissions,
  conversations,
  messages,
  userContentPackStates,
  userMediaProgress,
] as const;

describe("database schema", () => {
  it("defines the current versioned database table set", () => {
    expect(allTables.map(getTableName).sort()).toEqual(
      [
        "acquisition_runs",
        "acquisition_sources",
        "audio_assets",
        "article_assets",
        "article_segments",
        "article_sources",
        "article_versions",
        "articles",
        "character_canon_facts",
        "character_introduction_offers",
        "character_relationships",
        "characters",
        "candidate_artifacts",
        "candidate_processing_attempts",
        "candidate_reviews",
        "communication_domains",
        "content_bundle_imports",
        "content_candidates",
        "content_pack_activities",
        "content_pack_segments",
        "content_packs",
        "content_reviews",
        "content_sources",
        "conversations",
        "diagnostic_events",
        "evidence_events",
        "expression_tags",
        "expression_variants",
        "expressions",
        "idempotency_keys",
        "learning_breakpoints",
        "learning_goals",
        "media_assets",
        "media_items",
        "media_segments",
        "media_versions",
        "memory_sharing_permissions",
        "messages",
        "practice_attempts",
        "practice_session_activity_events",
        "practice_sessions",
        "profiles",
        "provider_calls",
        "privacy_cleanup_tasks",
        "relationship_memories",
        "scenario_tasks",
        "scenarios",
        "tags",
        "user_article_highlights",
        "user_article_saves",
        "user_media_progress",
        "user_preferences",
        "user_reading_progress",
        "user_saved_article_sources",
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

  it("keeps explore state versioned and user-owned", () => {
    const columns = getTableColumns(userContentPackStates);
    expect(columns).toHaveProperty("userId");
    expect(columns).toHaveProperty("packStableKey");
    expect(columns).toHaveProperty("packVersion");
    expect(columns).toHaveProperty("saved");
    expect(columns).toHaveProperty("completedSteps");
    expect(columns).toHaveProperty("totalSteps");
    const config = getTableConfig(userContentPackStates);
    expect(config.indexes.map((index) => index.config.name)).toContain("user_content_pack_states_user_last_opened_idx");
    expect(config.foreignKeys).toHaveLength(1);
  });

  it("applies the versioned migration to an empty PostgreSQL database", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        create role anon nologin;
        create role authenticated nologin;
        create schema auth;
        create table auth.users (
          id uuid primary key,
          email text,
          raw_user_meta_data jsonb not null default '{}'::jsonb
        );
        create function auth.uid()
        returns uuid
        language sql
        stable
        as $$
          select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        grant usage on schema auth to anon, authenticated;
        grant execute on function auth.uid() to anon, authenticated;
      `);
      for (const migrationName of [
        "0000_big_phalanx.sql",
        "0001_auth_rls.sql",
        "0002_content_import_registry.sql",
        "0003_chunky_black_knight.sql",
        "0004_calm_iron_monger.sql",
        "0005_kind_character_network.sql",
        "0006_opposite_centennial.sql",
        "0007_spicy_talkback.sql",
        "0008_broad_chronomancer.sql",
        "0009_oval_namora.sql",
        "0010_watery_ogun.sql",
        "0011_early_colleen_wing.sql",
        "0023_article_acquisition.sql",
        "0012_wakeful_spiral.sql",
        "0021_shallow_killmonger.sql",
        "0024_media_library_foundation.sql",
      ]) {
        const migrationPath = path.join(
          process.cwd(),
          "drizzle",
          migrationName,
        );
        const migration = (await readFile(migrationPath, "utf8")).replaceAll(
          "--> statement-breakpoint",
          "",
        );
        await database.exec(migration);
      }

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
  }, 10_000);
});
