CREATE TABLE "acquisition_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"generation_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"initial_cursor" text,
	"committed_cursor" text,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acquisition_runs_status_check" CHECK ("acquisition_runs"."status" in ('running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "acquisition_runs_counts_nonnegative_check" CHECK ("acquisition_runs"."inserted_count" >= 0 and "acquisition_runs"."duplicate_count" >= 0 and "acquisition_runs"."conflict_count" >= 0),
	CONSTRAINT "acquisition_runs_cost_nonnegative_check" CHECK ("acquisition_runs"."estimated_cost_micros" >= 0),
	CONSTRAINT "acquisition_runs_completed_at_check" CHECK (("acquisition_runs"."status" = 'running' and "acquisition_runs"."completed_at" is null) or ("acquisition_runs"."status" <> 'running' and "acquisition_runs"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "acquisition_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"adapter_type" text NOT NULL,
	"source_kind" text NOT NULL,
	"external_source_id" text NOT NULL,
	"display_name" text NOT NULL,
	"language" text NOT NULL,
	"region" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"rights_status" text DEFAULT 'unknown' NOT NULL,
	"rights_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rate_limit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acquisition_sources_revision_positive_check" CHECK ("acquisition_sources"."revision" > 0),
	CONSTRAINT "acquisition_sources_adapter_check" CHECK ("acquisition_sources"."adapter_type" in ('fake', 'youtube', 'podcast-rss', 'article-rss', 'custom')),
	CONSTRAINT "acquisition_sources_kind_check" CHECK ("acquisition_sources"."source_kind" in ('video-channel', 'podcast-feed', 'article-feed', 'article-site')),
	CONSTRAINT "acquisition_sources_rights_check" CHECK ("acquisition_sources"."rights_status" in ('unknown', 'verified', 'restricted', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "candidate_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"artifact_type" text NOT NULL,
	"storage_key" text,
	"content_hash" text,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"ephemeral" boolean DEFAULT false NOT NULL,
	"retain_until" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_artifacts_size_nonnegative_check" CHECK ("candidate_artifacts"."byte_size" >= 0),
	CONSTRAINT "candidate_artifacts_status_check" CHECK ("candidate_artifacts"."status" in ('pending', 'available', 'delete-pending', 'deleted', 'failed')),
	CONSTRAINT "candidate_artifacts_hash_check" CHECK ("candidate_artifacts"."content_hash" is null or "candidate_artifacts"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "candidate_processing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"job_id" text NOT NULL,
	"generation_id" text NOT NULL,
	"expected_revision" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_processing_attempts_revision_positive_check" CHECK ("candidate_processing_attempts"."expected_revision" > 0),
	CONSTRAINT "candidate_processing_attempts_cost_nonnegative_check" CHECK ("candidate_processing_attempts"."estimated_cost_micros" >= 0),
	CONSTRAINT "candidate_processing_attempts_status_check" CHECK ("candidate_processing_attempts"."status" in ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')),
	CONSTRAINT "candidate_processing_attempts_completed_at_check" CHECK ("candidate_processing_attempts"."status" in ('pending', 'running') or "candidate_processing_attempts"."completed_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "candidate_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_reference" text,
	"candidate_revision" integer NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_reviews_revision_positive_check" CHECK ("candidate_reviews"."candidate_revision" > 0),
	CONSTRAINT "candidate_reviews_dimension_check" CHECK ("candidate_reviews"."dimension" in ('rights', 'content-es-ES', 'teaching-zh-CN', 'structure', 'owner-release')),
	CONSTRAINT "candidate_reviews_status_check" CHECK ("candidate_reviews"."status" in ('pending', 'approved', 'changes_requested', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "content_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_item_id" text NOT NULL,
	"normalized_url" text NOT NULL,
	"title" text NOT NULL,
	"content_type" text NOT NULL,
	"language" text NOT NULL,
	"published_at" timestamp with time zone,
	"content_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'discovered' NOT NULL,
	"rights_status" text DEFAULT 'unknown' NOT NULL,
	"generation_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_candidates_revision_positive_check" CHECK ("content_candidates"."revision" > 0),
	CONSTRAINT "content_candidates_type_check" CHECK ("content_candidates"."content_type" in ('video', 'podcast', 'article')),
	CONSTRAINT "content_candidates_status_check" CHECK ("content_candidates"."status" in ('discovered', 'screened', 'acquiring', 'processing', 'review_ready', 'failed', 'rejected')),
	CONSTRAINT "content_candidates_rights_check" CHECK ("content_candidates"."rights_status" in ('unknown', 'verified', 'restricted', 'revoked')),
	CONSTRAINT "content_candidates_hash_check" CHECK ("content_candidates"."content_hash" is null or "content_candidates"."content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "content_candidates_rejected_at_check" CHECK (("content_candidates"."status" = 'rejected' and "content_candidates"."rejected_at" is not null) or ("content_candidates"."status" <> 'rejected' and "content_candidates"."rejected_at" is null))
);
--> statement-breakpoint
ALTER TABLE "acquisition_runs" ADD CONSTRAINT "acquisition_runs_source_id_acquisition_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."acquisition_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_artifacts" ADD CONSTRAINT "candidate_artifacts_candidate_id_content_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."content_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_processing_attempts" ADD CONSTRAINT "candidate_processing_attempts_candidate_id_content_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."content_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_reviews" ADD CONSTRAINT "candidate_reviews_candidate_id_content_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."content_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_candidates" ADD CONSTRAINT "content_candidates_source_id_acquisition_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."acquisition_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acquisition_runs_source_generation_uidx" ON "acquisition_runs" USING btree ("source_id","generation_id");--> statement-breakpoint
CREATE INDEX "acquisition_runs_source_started_idx" ON "acquisition_runs" USING btree ("source_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "acquisition_sources_stable_key_uidx" ON "acquisition_sources" USING btree ("stable_key");--> statement-breakpoint
CREATE UNIQUE INDEX "acquisition_sources_adapter_external_uidx" ON "acquisition_sources" USING btree ("adapter_type","external_source_id");--> statement-breakpoint
CREATE INDEX "acquisition_sources_enabled_schedule_idx" ON "acquisition_sources" USING btree ("enabled","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_artifacts_candidate_type_hash_uidx" ON "candidate_artifacts" USING btree ("candidate_id","artifact_type","content_hash");--> statement-breakpoint
CREATE INDEX "candidate_artifacts_cleanup_idx" ON "candidate_artifacts" USING btree ("status","retain_until");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_processing_attempts_job_generation_uidx" ON "candidate_processing_attempts" USING btree ("job_id","generation_id");--> statement-breakpoint
CREATE INDEX "candidate_processing_attempts_candidate_started_idx" ON "candidate_processing_attempts" USING btree ("candidate_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_reviews_candidate_dimension_revision_uidx" ON "candidate_reviews" USING btree ("candidate_id","dimension","candidate_revision");--> statement-breakpoint
CREATE INDEX "candidate_reviews_status_updated_idx" ON "candidate_reviews" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "content_candidates_source_item_uidx" ON "content_candidates" USING btree ("source_id","external_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_candidates_normalized_url_uidx" ON "content_candidates" USING btree ("normalized_url");--> statement-breakpoint
CREATE UNIQUE INDEX "content_candidates_content_hash_uidx" ON "content_candidates" USING btree ("content_hash") WHERE "content_candidates"."content_hash" is not null;--> statement-breakpoint
CREATE INDEX "content_candidates_status_activity_idx" ON "content_candidates" USING btree ("status","last_activity_at");
--> statement-breakpoint
ALTER TABLE "acquisition_sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "acquisition_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "content_candidates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_artifacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_processing_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON TABLE "acquisition_sources", "acquisition_runs", "content_candidates", "candidate_artifacts", "candidate_processing_attempts", "candidate_reviews" FROM anon;
	END IF;
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
		REVOKE ALL ON TABLE "acquisition_sources", "acquisition_runs", "content_candidates", "candidate_artifacts", "candidate_processing_attempts", "candidate_reviews" FROM authenticated;
	END IF;
END $$;
