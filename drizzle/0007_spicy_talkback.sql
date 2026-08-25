CREATE TABLE "privacy_cleanup_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_cleanup_tasks_status_check" CHECK ("privacy_cleanup_tasks"."status" in ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "privacy_cleanup_tasks_attempts_nonnegative_check" CHECK ("privacy_cleanup_tasks"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_cleanup_tasks_location_uidx" ON "privacy_cleanup_tasks" USING btree ("storage_bucket","storage_path");--> statement-breakpoint
CREATE INDEX "privacy_cleanup_tasks_status_next_attempt_idx" ON "privacy_cleanup_tasks" USING btree ("status","next_attempt_at");
--> statement-breakpoint
ALTER TABLE public.privacy_cleanup_tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.privacy_cleanup_tasks FROM anon, authenticated;
