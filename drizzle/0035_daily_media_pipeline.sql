CREATE TABLE "content_pipeline_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"trigger" text NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"lease_token" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_pipeline_runs_trigger_check" CHECK ("content_pipeline_runs"."trigger" in ('scheduled', 'manual')),
	CONSTRAINT "content_pipeline_runs_status_check" CHECK ("content_pipeline_runs"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "content_pipeline_runs_cost_nonnegative_check" CHECK ("content_pipeline_runs"."estimated_cost_micros" >= 0),
	CONSTRAINT "content_pipeline_runs_completed_at_check" CHECK (("content_pipeline_runs"."status" = 'running' and "content_pipeline_runs"."completed_at" is null) or ("content_pipeline_runs"."status" <> 'running' and "content_pipeline_runs"."completed_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_pipeline_runs_active_scope_uidx" ON "content_pipeline_runs" USING btree ("scope") WHERE "content_pipeline_runs"."status" = 'running';
--> statement-breakpoint
CREATE INDEX "content_pipeline_runs_scope_started_idx" ON "content_pipeline_runs" USING btree ("scope","started_at");
--> statement-breakpoint
CREATE TABLE "content_pipeline_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"generation_id" text NOT NULL,
	"step" text NOT NULL,
	"input_hash" text NOT NULL,
	"provider" text NOT NULL,
	"model_version" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"lease_token" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"output" jsonb,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"estimated_cost_micros" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_pipeline_steps_candidate_id_content_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."content_candidates"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "content_pipeline_steps_hash_check" CHECK ("content_pipeline_steps"."input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "content_pipeline_steps_status_check" CHECK ("content_pipeline_steps"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "content_pipeline_steps_attempt_positive_check" CHECK ("content_pipeline_steps"."attempt_count" > 0),
	CONSTRAINT "content_pipeline_steps_cost_nonnegative_check" CHECK ("content_pipeline_steps"."estimated_cost_micros" >= 0),
	CONSTRAINT "content_pipeline_steps_completed_at_check" CHECK (("content_pipeline_steps"."status" = 'running' and "content_pipeline_steps"."completed_at" is null) or ("content_pipeline_steps"."status" <> 'running' and "content_pipeline_steps"."completed_at" is not null)),
	CONSTRAINT "content_pipeline_steps_output_check" CHECK ("content_pipeline_steps"."status" <> 'succeeded' or "content_pipeline_steps"."output" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "content_pipeline_steps_logical_uidx" ON "content_pipeline_steps" USING btree ("candidate_id","generation_id","step","input_hash","provider","model_version");
--> statement-breakpoint
CREATE INDEX "content_pipeline_steps_lease_idx" ON "content_pipeline_steps" USING btree ("status","lease_expires_at");
