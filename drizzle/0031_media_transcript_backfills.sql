CREATE TYPE "public"."media_transcript_backfill_status" AS ENUM('draft', 'approved', 'published', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."media_transcript_review_dimension" AS ENUM('content-es-ES', 'teaching-zh-CN', 'structure');--> statement-breakpoint
CREATE TYPE "public"."media_transcript_backfill_review_status" AS ENUM('pending', 'approved', 'changes_requested', 'rejected');--> statement-breakpoint
CREATE TABLE "media_transcript_backfills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "media_version_id" uuid NOT NULL,
  "media_item_id" uuid NOT NULL,
  "source_version" integer NOT NULL,
  "audio_hash" text NOT NULL,
  "segments" jsonb NOT NULL,
  "provider" text NOT NULL,
  "model_version" text NOT NULL,
  "low_confidence" boolean DEFAULT false NOT NULL,
  "translation_failed_count" integer DEFAULT 0 NOT NULL,
  "status" "media_transcript_backfill_status" DEFAULT 'draft' NOT NULL,
  "published_version" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "media_transcript_backfills_hash_check" CHECK ("media_transcript_backfills"."audio_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "media_transcript_backfills_translation_count_check" CHECK ("media_transcript_backfills"."translation_failed_count" >= 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "media_transcript_backfills_version_hash_uidx" ON "media_transcript_backfills" USING btree ("media_version_id","audio_hash");--> statement-breakpoint
CREATE INDEX "media_transcript_backfills_status_idx" ON "media_transcript_backfills" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "media_transcript_backfills" ADD CONSTRAINT "media_transcript_backfills_media_version_id_media_versions_id_fk" FOREIGN KEY ("media_version_id") REFERENCES "public"."media_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_transcript_backfills" ADD CONSTRAINT "media_transcript_backfills_media_item_id_media_items_id_fk" FOREIGN KEY ("media_item_id") REFERENCES "public"."media_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "media_transcript_backfill_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "backfill_id" uuid NOT NULL,
  "dimension" "media_transcript_review_dimension" NOT NULL,
  "status" "media_transcript_backfill_review_status" DEFAULT 'pending' NOT NULL,
  "reviewer_reference" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "media_transcript_backfill_reviews_dimension_uidx" ON "media_transcript_backfill_reviews" USING btree ("backfill_id","dimension");--> statement-breakpoint
ALTER TABLE "media_transcript_backfill_reviews" ADD CONSTRAINT "media_transcript_backfill_reviews_backfill_id_media_transcript_backfills_id_fk" FOREIGN KEY ("backfill_id") REFERENCES "public"."media_transcript_backfills"("id") ON DELETE cascade ON UPDATE no action;
