CREATE TYPE "public"."content_status" AS ENUM('draft', 'review', 'approved', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."memory_sensitivity" AS ENUM('normal', 'sensitive', 'private');--> statement-breakpoint
CREATE TYPE "public"."memory_share_scope" AS ENUM('private', 'character', 'explicit');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'character', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('streaming', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."learning_modality" AS ENUM('speech', 'typing', 'listening', 'reading');--> statement-breakpoint
CREATE TYPE "public"."provider_call_status" AS ENUM('started', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."practice_session_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."content_source_license" AS ENUM('original', 'public_domain', 'creative_commons', 'licensed', 'short_quote');--> statement-breakpoint
CREATE TABLE "character_canon_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"fact_key" text NOT NULL,
	"value" jsonb NOT NULL,
	"sensitivity" "memory_sensitivity" DEFAULT 'normal' NOT NULL,
	"canon_version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "character_canon_facts_version_positive_check" CHECK ("character_canon_facts"."canon_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "character_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"relationship_stage" text DEFAULT 'new_contact' NOT NULL,
	"revealed_canon_fact_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relationship_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"home_location" text NOT NULL,
	"profile" jsonb NOT NULL,
	"character_version" integer DEFAULT 1 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "characters_version_positive_check" CHECK ("characters"."character_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_sharing_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"target_character_id" uuid NOT NULL,
	"is_allowed" boolean DEFAULT true NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"character_id" uuid,
	"client_message_id" text NOT NULL,
	"generation_id" text,
	"role" "message_role" NOT NULL,
	"status" "message_status" DEFAULT 'completed' NOT NULL,
	"content" text NOT NULL,
	"reply_to_message_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"source_conversation_id" uuid,
	"source_message_id" uuid,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"confidence" real NOT NULL,
	"sensitivity" "memory_sensitivity" DEFAULT 'normal' NOT NULL,
	"share_scope" "memory_share_scope" DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relationship_memories_confidence_range_check" CHECK ("relationship_memories"."confidence" >= 0 and "relationship_memories"."confidence" <= 1),
	CONSTRAINT "relationship_memories_status_check" CHECK ("relationship_memories"."status" in ('candidate', 'confirmed', 'rejected', 'conflict'))
);
--> statement-breakpoint
CREATE TABLE "communication_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"title" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pack_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_pack_id" uuid NOT NULL,
	"segment_id" uuid,
	"activity_type" text NOT NULL,
	"modality" text NOT NULL,
	"instructions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_pack_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_pack_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_text" text NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"audio_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"title" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cefr_level" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"locale" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewer_reference" text,
	"notes" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_pack_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"source_url" text,
	"license" "content_source_license" NOT NULL,
	"attribution" text,
	"license_evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expression_tags" (
	"expression_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"weight" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expression_tags_expression_id_tag_id_pk" PRIMARY KEY("expression_id","tag_id"),
	CONSTRAINT "expression_tags_weight_range_check" CHECK ("expression_tags"."weight" > 0 and "expression_tags"."weight" <= 1)
);
--> statement-breakpoint
CREATE TABLE "expression_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expression_id" uuid NOT NULL,
	"variant_text" text NOT NULL,
	"usage_notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"region" text,
	"register" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"stable_key" text NOT NULL,
	"source_text" text NOT NULL,
	"translations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"communicative_intent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"grammar_notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pronunciation_notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"usage_notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cefr_level" text NOT NULL,
	"register" text DEFAULT 'neutral' NOT NULL,
	"region" text DEFAULT 'es-ES' NOT NULL,
	"frequency" text DEFAULT 'core' NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expressions_version_positive_check" CHECK ("expressions"."content_version" > 0),
	CONSTRAINT "expressions_frequency_check" CHECK ("expressions"."frequency" in ('core', 'common', 'extension'))
);
--> statement-breakpoint
CREATE TABLE "learning_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain_id" uuid NOT NULL,
	"stable_key" text NOT NULL,
	"title" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cefr_min" text DEFAULT 'A1' NOT NULL,
	"cefr_max" text DEFAULT 'B1' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scenario_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"prompt" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"success_criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_expression_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"title" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setting" text NOT NULL,
	"relationship_type" text NOT NULL,
	"cefr_level" text NOT NULL,
	"content_version" integer DEFAULT 1 NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"category" text NOT NULL,
	"label" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"practice_attempt_id" uuid,
	"provider_call_id" uuid,
	"idempotency_key" text NOT NULL,
	"source_type" text NOT NULL,
	"source_reference" jsonb,
	"skill_key" text NOT NULL,
	"scenario_id" uuid,
	"modality" "learning_modality" NOT NULL,
	"outcome_score" real NOT NULL,
	"evidence_weight" real NOT NULL,
	"confidence" real NOT NULL,
	"content_version" integer NOT NULL,
	"algorithm_version" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_events_outcome_score_range_check" CHECK ("evidence_events"."outcome_score" >= 0 and "evidence_events"."outcome_score" <= 1),
	CONSTRAINT "evidence_events_weight_range_check" CHECK ("evidence_events"."evidence_weight" > 0 and "evidence_events"."evidence_weight" <= 1),
	CONSTRAINT "evidence_events_confidence_range_check" CHECK ("evidence_events"."confidence" >= 0 and "evidence_events"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "user_scene_states" (
	"user_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"mastery" real DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"oral_coverage" real DEFAULT 0 NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"last_verified_at" timestamp with time zone,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_scene_states_user_id_scenario_id_pk" PRIMARY KEY("user_id","scenario_id"),
	CONSTRAINT "user_scene_states_status_check" CHECK ("user_scene_states"."status" in ('unverified', 'learning', 'provisional', 'mastered', 'needs_review')),
	CONSTRAINT "user_scene_states_mastery_range_check" CHECK ("user_scene_states"."mastery" >= 0 and "user_scene_states"."mastery" <= 1),
	CONSTRAINT "user_scene_states_confidence_range_check" CHECK ("user_scene_states"."confidence" >= 0 and "user_scene_states"."confidence" <= 1),
	CONSTRAINT "user_scene_states_oral_coverage_range_check" CHECK ("user_scene_states"."oral_coverage" >= 0 and "user_scene_states"."oral_coverage" <= 1)
);
--> statement-breakpoint
CREATE TABLE "user_skill_states" (
	"user_id" uuid NOT NULL,
	"skill_key" text NOT NULL,
	"mastery" real DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"last_evidence_at" timestamp with time zone,
	"snapshot_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_skill_states_user_id_skill_key_pk" PRIMARY KEY("user_id","skill_key"),
	CONSTRAINT "user_skill_states_mastery_range_check" CHECK ("user_skill_states"."mastery" >= 0 and "user_skill_states"."mastery" <= 1),
	CONSTRAINT "user_skill_states_confidence_range_check" CHECK ("user_skill_states"."confidence" >= 0 and "user_skill_states"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "audio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"storage_bucket" text NOT NULL,
	"storage_path" text NOT NULL,
	"purpose" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer,
	"retention_policy" text DEFAULT 'ephemeral' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_assets_size_nonnegative_check" CHECK ("audio_assets"."size_bytes" >= 0),
	CONSTRAINT "audio_assets_duration_nonnegative_check" CHECK ("audio_assets"."duration_ms" is null or "audio_assets"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"response_reference" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_status_check" CHECK ("idempotency_keys"."status" in ('started', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "provider_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"provider_type" text NOT NULL,
	"provider" text NOT NULL,
	"model_version" text,
	"provider_request_id" text,
	"status" "provider_call_status" DEFAULT 'started' NOT NULL,
	"latency_ms" integer,
	"estimated_cost_micros" integer,
	"confidence_basis_points" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_calls_latency_nonnegative_check" CHECK ("provider_calls"."latency_ms" is null or "provider_calls"."latency_ms" >= 0),
	CONSTRAINT "provider_calls_confidence_range_check" CHECK ("provider_calls"."confidence_basis_points" is null or ("provider_calls"."confidence_basis_points" >= 0 and "provider_calls"."confidence_basis_points" <= 10000))
);
--> statement-breakpoint
CREATE TABLE "learning_breakpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"state" jsonb NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_breakpoints_generation_positive_check" CHECK ("learning_breakpoints"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "practice_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"scenario_task_id" uuid,
	"client_attempt_id" text NOT NULL,
	"modality" "learning_modality" NOT NULL,
	"response_text" text,
	"audio_asset_id" uuid,
	"hint_level" integer DEFAULT 0 NOT NULL,
	"transcript_confidence" real,
	"evaluation" jsonb,
	"content_version" integer NOT NULL,
	"algorithm_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_attempts_hint_level_check" CHECK ("practice_attempts"."hint_level" >= 0 and "practice_attempts"."hint_level" <= 3),
	CONSTRAINT "practice_attempts_transcript_confidence_check" CHECK ("practice_attempts"."transcript_confidence" is null or ("practice_attempts"."transcript_confidence" >= 0 and "practice_attempts"."transcript_confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"scenario_id" uuid,
	"status" "practice_session_status" DEFAULT 'active' NOT NULL,
	"primary_modality" "learning_modality" NOT NULL,
	"content_version" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_sessions_content_version_positive_check" CHECK ("practice_sessions"."content_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"native_language" text DEFAULT 'zh-CN' NOT NULL,
	"interface_language" text DEFAULT 'zh-CN' NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preferred_spanish_region" text DEFAULT 'es-ES' NOT NULL,
	"correction_mode" text DEFAULT 'balanced' NOT NULL,
	"voice_input_preferred" text DEFAULT 'preferred' NOT NULL,
	"personality_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_correction_mode_check" CHECK ("user_preferences"."correction_mode" in ('balanced', 'strict')),
	CONSTRAINT "user_preferences_voice_preference_check" CHECK ("user_preferences"."voice_input_preferred" in ('preferred', 'optional', 'silent'))
);
--> statement-breakpoint
ALTER TABLE "character_canon_facts" ADD CONSTRAINT "character_canon_facts_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_relationships" ADD CONSTRAINT "character_relationships_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sharing_permissions" ADD CONSTRAINT "memory_sharing_permissions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sharing_permissions" ADD CONSTRAINT "memory_sharing_permissions_memory_id_relationship_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."relationship_memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sharing_permissions" ADD CONSTRAINT "memory_sharing_permissions_target_character_id_characters_id_fk" FOREIGN KEY ("target_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_memories" ADD CONSTRAINT "relationship_memories_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_memories" ADD CONSTRAINT "relationship_memories_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_memories" ADD CONSTRAINT "relationship_memories_source_conversation_id_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_memories" ADD CONSTRAINT "relationship_memories_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_activities" ADD CONSTRAINT "content_pack_activities_content_pack_id_content_packs_id_fk" FOREIGN KEY ("content_pack_id") REFERENCES "public"."content_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_activities" ADD CONSTRAINT "content_pack_activities_segment_id_content_pack_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."content_pack_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_segments" ADD CONSTRAINT "content_pack_segments_content_pack_id_content_packs_id_fk" FOREIGN KEY ("content_pack_id") REFERENCES "public"."content_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_pack_segments" ADD CONSTRAINT "content_pack_segments_audio_asset_id_audio_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_content_pack_id_content_packs_id_fk" FOREIGN KEY ("content_pack_id") REFERENCES "public"."content_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expression_tags" ADD CONSTRAINT "expression_tags_expression_id_expressions_id_fk" FOREIGN KEY ("expression_id") REFERENCES "public"."expressions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expression_tags" ADD CONSTRAINT "expression_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expression_variants" ADD CONSTRAINT "expression_variants_expression_id_expressions_id_fk" FOREIGN KEY ("expression_id") REFERENCES "public"."expressions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expressions" ADD CONSTRAINT "expressions_goal_id_learning_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_goals" ADD CONSTRAINT "learning_goals_domain_id_communication_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."communication_domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_tasks" ADD CONSTRAINT "scenario_tasks_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_tasks" ADD CONSTRAINT "scenario_tasks_goal_id_learning_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_practice_attempt_id_practice_attempts_id_fk" FOREIGN KEY ("practice_attempt_id") REFERENCES "public"."practice_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_provider_call_id_provider_calls_id_fk" FOREIGN KEY ("provider_call_id") REFERENCES "public"."provider_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_events" ADD CONSTRAINT "evidence_events_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scene_states" ADD CONSTRAINT "user_scene_states_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scene_states" ADD CONSTRAINT "user_scene_states_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_skill_states" ADD CONSTRAINT "user_skill_states_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD CONSTRAINT "provider_calls_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_breakpoints" ADD CONSTRAINT "learning_breakpoints_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_breakpoints" ADD CONSTRAINT "learning_breakpoints_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_scenario_task_id_scenario_tasks_id_fk" FOREIGN KEY ("scenario_task_id") REFERENCES "public"."scenario_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_audio_asset_id_audio_assets_id_fk" FOREIGN KEY ("audio_asset_id") REFERENCES "public"."audio_assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_goal_id_learning_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."learning_goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "character_canon_facts_key_version_uidx" ON "character_canon_facts" USING btree ("character_id","fact_key","canon_version");--> statement-breakpoint
CREATE INDEX "character_canon_facts_character_idx" ON "character_canon_facts" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_relationships_user_character_uidx" ON "character_relationships" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "character_relationships_user_updated_idx" ON "character_relationships" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "characters_stable_version_uidx" ON "characters" USING btree ("stable_key","character_version");--> statement-breakpoint
CREATE INDEX "characters_status_idx" ON "characters" USING btree ("status");--> statement-breakpoint
CREATE INDEX "conversations_user_last_message_idx" ON "conversations" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_user_character_idx" ON "conversations" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_sharing_permissions_target_uidx" ON "memory_sharing_permissions" USING btree ("memory_id","target_character_id");--> statement-breakpoint
CREATE INDEX "memory_sharing_permissions_user_idx" ON "memory_sharing_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_client_id_uidx" ON "messages" USING btree ("conversation_id","client_message_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_user_created_idx" ON "messages" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "relationship_memories_user_character_idx" ON "relationship_memories" USING btree ("user_id","character_id");--> statement-breakpoint
CREATE INDEX "relationship_memories_user_status_idx" ON "relationship_memories" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "communication_domains_stable_key_uidx" ON "communication_domains" USING btree ("stable_key");--> statement-breakpoint
CREATE INDEX "communication_domains_status_position_idx" ON "communication_domains" USING btree ("status","position");--> statement-breakpoint
CREATE INDEX "content_pack_activities_pack_position_idx" ON "content_pack_activities" USING btree ("content_pack_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "content_pack_segments_pack_position_uidx" ON "content_pack_segments" USING btree ("content_pack_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "content_packs_stable_version_uidx" ON "content_packs" USING btree ("stable_key","content_version");--> statement-breakpoint
CREATE INDEX "content_packs_status_cefr_idx" ON "content_packs" USING btree ("status","cefr_level");--> statement-breakpoint
CREATE INDEX "content_reviews_entity_idx" ON "content_reviews" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "content_reviews_status_idx" ON "content_reviews" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_sources_pack_idx" ON "content_sources" USING btree ("content_pack_id");--> statement-breakpoint
CREATE INDEX "expression_tags_tag_idx" ON "expression_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "expression_variants_expression_position_idx" ON "expression_variants" USING btree ("expression_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "expressions_stable_version_uidx" ON "expressions" USING btree ("stable_key","content_version");--> statement-breakpoint
CREATE INDEX "expressions_goal_status_idx" ON "expressions" USING btree ("goal_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_goals_stable_key_uidx" ON "learning_goals" USING btree ("stable_key");--> statement-breakpoint
CREATE INDEX "learning_goals_domain_position_idx" ON "learning_goals" USING btree ("domain_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_tasks_scenario_position_uidx" ON "scenario_tasks" USING btree ("scenario_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_stable_version_uidx" ON "scenarios" USING btree ("stable_key","content_version");--> statement-breakpoint
CREATE INDEX "scenarios_status_cefr_idx" ON "scenarios" USING btree ("status","cefr_level");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_stable_key_uidx" ON "tags" USING btree ("stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_events_user_idempotency_uidx" ON "evidence_events" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "evidence_events_user_occurred_idx" ON "evidence_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "evidence_events_user_skill_occurred_idx" ON "evidence_events" USING btree ("user_id","skill_key","occurred_at");--> statement-breakpoint
CREATE INDEX "evidence_events_attempt_idx" ON "evidence_events" USING btree ("practice_attempt_id");--> statement-breakpoint
CREATE INDEX "user_scene_states_user_status_idx" ON "user_scene_states" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "user_skill_states_user_updated_idx" ON "user_skill_states" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audio_assets_storage_location_uidx" ON "audio_assets" USING btree ("storage_bucket","storage_path");--> statement-breakpoint
CREATE INDEX "audio_assets_user_created_idx" ON "audio_assets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_key_uidx" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_user_created_idx" ON "idempotency_keys" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "provider_calls_user_started_idx" ON "provider_calls" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "provider_calls_provider_status_idx" ON "provider_calls" USING btree ("provider_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_breakpoints_session_uidx" ON "learning_breakpoints" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "learning_breakpoints_user_updated_idx" ON "learning_breakpoints" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_attempts_user_client_attempt_uidx" ON "practice_attempts" USING btree ("user_id","client_attempt_id");--> statement-breakpoint
CREATE INDEX "practice_attempts_session_created_idx" ON "practice_attempts" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "practice_sessions_user_started_idx" ON "practice_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "practice_sessions_user_status_idx" ON "practice_sessions" USING btree ("user_id","status");--> statement-breakpoint
COMMENT ON TABLE "evidence_events" IS 'Append-only learning evidence. Application roles may insert through validated server use cases but must not update or delete history.';--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE UPDATE, DELETE ON TABLE public.evidence_events FROM anon;
	END IF;

	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		REVOKE UPDATE, DELETE ON TABLE public.evidence_events FROM authenticated;
	END IF;
END
$$;
