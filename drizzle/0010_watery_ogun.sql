CREATE TABLE "diagnostic_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"dedupe_key" text NOT NULL,
	"request_id" text,
	"session_id" text,
	"attempt_id" text,
	"conversation_id" text,
	"generation_id" text,
	"error_type" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "diagnostic_events_type_check" CHECK ("diagnostic_events"."event_type" in ('conversation.stream_failed', 'evidence.duplicate', 'memory.conflict', 'privacy.storage_cleanup_failed')),
	CONSTRAINT "diagnostic_events_severity_check" CHECK ("diagnostic_events"."severity" in ('warning', 'alert')),
	CONSTRAINT "diagnostic_events_status_check" CHECK ("diagnostic_events"."status" in ('open', 'acknowledged', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "diagnostic_events" ADD CONSTRAINT "diagnostic_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diagnostic_events_dedupe_uidx" ON "diagnostic_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "diagnostic_events_occurred_idx" ON "diagnostic_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "diagnostic_events_type_status_occurred_idx" ON "diagnostic_events" USING btree ("event_type","status","occurred_at");
--> statement-breakpoint
ALTER TABLE "diagnostic_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "diagnostic_events" FROM anon, authenticated;
