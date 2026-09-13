CREATE TYPE "public"."media_asset_availability" AS ENUM('available', 'unavailable', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."media_asset_kind" AS ENUM('official_embed', 'audio', 'video');--> statement-breakpoint
CREATE TYPE "public"."media_kind" AS ENUM('video', 'podcast');--> statement-breakpoint
CREATE TYPE "public"."media_progress_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_version_id" uuid NOT NULL,
	"kind" "media_asset_kind" NOT NULL,
	"provider_key" text NOT NULL,
	"playback_url" text NOT NULL,
	"playback_expires_at" timestamp with time zone,
	"mime_type" text,
	"availability" "media_asset_availability" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_https_check" CHECK ("media_assets"."playback_url" ~ '^https://'),
	CONSTRAINT "media_assets_expiry_policy_check" CHECK ("media_assets"."kind" = 'official_embed' or "media_assets"."playback_expires_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "media_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"kind" "media_kind" NOT NULL,
	"current_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_items_current_version_positive_check" CHECK ("media_items"."current_version" is null or "media_items"."current_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_version_id" uuid NOT NULL,
	"segment_index" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"speaker" text,
	"source_text" text NOT NULL,
	"translation" text,
	"confidence" real,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_segments_time_check" CHECK ("media_segments"."segment_index" >= 0 and "media_segments"."start_ms" >= 0 and "media_segments"."end_ms" > "media_segments"."start_ms"),
	CONSTRAINT "media_segments_confidence_check" CHECK ("media_segments"."confidence" is null or ("media_segments"."confidence" >= 0 and "media_segments"."confidence" <= 1))
);
--> statement-breakpoint
CREATE TABLE "media_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"locale" text DEFAULT 'es-ES' NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"language" text DEFAULT 'es' NOT NULL,
	"region" text,
	"cefr" text,
	"topics" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"duration_ms" integer NOT NULL,
	"publication_date" timestamp with time zone,
	"curated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"content_hash" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"license" "content_source_license" NOT NULL,
	"attribution" text NOT NULL,
	"license_evidence" text NOT NULL,
	"copyright_status" text DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_versions_version_positive_check" CHECK ("media_versions"."version" > 0),
	CONSTRAINT "media_versions_duration_positive_check" CHECK ("media_versions"."duration_ms" > 0),
	CONSTRAINT "media_versions_hash_check" CHECK ("media_versions"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "media_versions_cefr_check" CHECK ("media_versions"."cefr" is null or "media_versions"."cefr" in ('A2', 'B1')),
	CONSTRAINT "media_versions_copyright_check" CHECK ("media_versions"."copyright_status" in ('unverified', 'cleared', 'restricted'))
);
--> statement-breakpoint
CREATE TABLE "user_media_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_version_id" uuid NOT NULL,
	"last_position_ms" integer DEFAULT 0 NOT NULL,
	"last_segment_index" integer,
	"status" "media_progress_status" DEFAULT 'in_progress' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_media_progress_values_check" CHECK ("user_media_progress"."last_position_ms" >= 0 and ("user_media_progress"."last_segment_index" is null or "user_media_progress"."last_segment_index" >= 0) and "user_media_progress"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_media_version_id_media_versions_id_fk" FOREIGN KEY ("media_version_id") REFERENCES "public"."media_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_segments" ADD CONSTRAINT "media_segments_media_version_id_media_versions_id_fk" FOREIGN KEY ("media_version_id") REFERENCES "public"."media_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_media_item_id_media_items_id_fk" FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_media_progress" ADD CONSTRAINT "user_media_progress_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_media_progress" ADD CONSTRAINT "user_media_progress_media_version_id_media_versions_id_fk" FOREIGN KEY ("media_version_id") REFERENCES "public"."media_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_version_kind_uidx" ON "media_assets" USING btree ("media_version_id","kind");--> statement-breakpoint
CREATE INDEX "media_assets_availability_idx" ON "media_assets" USING btree ("availability");--> statement-breakpoint
CREATE UNIQUE INDEX "media_items_stable_key_uidx" ON "media_items" USING btree ("stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_segments_version_index_uidx" ON "media_segments" USING btree ("media_version_id","segment_index");--> statement-breakpoint
CREATE INDEX "media_segments_version_start_idx" ON "media_segments" USING btree ("media_version_id","start_ms");--> statement-breakpoint
CREATE UNIQUE INDEX "media_versions_item_version_uidx" ON "media_versions" USING btree ("media_item_id","version");--> statement-breakpoint
CREATE INDEX "media_versions_status_curated_idx" ON "media_versions" USING btree ("status","curated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_media_progress_user_version_uidx" ON "user_media_progress" USING btree ("user_id","media_version_id");--> statement-breakpoint
CREATE INDEX "user_media_progress_user_opened_idx" ON "user_media_progress" USING btree ("user_id","last_opened_at");--> statement-breakpoint
ALTER TABLE public.media_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.media_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.media_segments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.user_media_progress ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.media_items, public.media_versions, public.media_assets, public.media_segments, public.user_media_progress FROM anon, authenticated;--> statement-breakpoint
CREATE POLICY user_media_progress_select_own ON public.user_media_progress FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY user_media_progress_insert_own ON public.user_media_progress FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY user_media_progress_update_own ON public.user_media_progress FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));--> statement-breakpoint
CREATE POLICY user_media_progress_delete_own ON public.user_media_progress FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_media_progress TO authenticated;
