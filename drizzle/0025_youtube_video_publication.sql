ALTER TABLE "media_segments" ADD COLUMN "source_kind" text;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "platform_source_id" text;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "source_channel_id" text;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "acquisition_candidate_id" uuid;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "acquisition_candidate_revision" integer;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "change_reason" text;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "review_notes" text;--> statement-breakpoint
CREATE UNIQUE INDEX "media_versions_candidate_revision_uidx" ON "media_versions" USING btree ("acquisition_candidate_id","acquisition_candidate_revision") WHERE "media_versions"."acquisition_candidate_id" is not null;--> statement-breakpoint
ALTER TABLE "media_segments" ADD CONSTRAINT "media_segments_source_kind_check" CHECK ("media_segments"."source_kind" is null or "media_segments"."source_kind" in ('platform_manual', 'platform_auto', 'asr'));--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_acquisition_provenance_check" CHECK (("media_versions"."acquisition_candidate_id" is null and "media_versions"."acquisition_candidate_revision" is null and "media_versions"."fetched_at" is null) or ("media_versions"."acquisition_candidate_id" is not null and "media_versions"."acquisition_candidate_revision" > 0 and "media_versions"."fetched_at" is not null));