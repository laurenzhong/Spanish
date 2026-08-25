CREATE TYPE "public"."practice_session_activity_event_type" AS ENUM('active', 'inactive', 'ended');--> statement-breakpoint
CREATE TABLE "practice_session_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"client_instance_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" "practice_session_activity_event_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_session_activity_events_sequence_nonnegative_check" CHECK ("practice_session_activity_events"."sequence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "practice_session_activity_events" ADD CONSTRAINT "practice_session_activity_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_session_activity_events" ADD CONSTRAINT "practice_session_activity_events_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "practice_session_activity_events_session_client_seq_uidx" ON "practice_session_activity_events" USING btree ("session_id","client_instance_id","sequence");--> statement-breakpoint
CREATE INDEX "practice_session_activity_events_user_session_occurred_idx" ON "practice_session_activity_events" USING btree ("user_id","session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "practice_session_activity_events_session_occurred_idx" ON "practice_session_activity_events" USING btree ("session_id","occurred_at");
--> statement-breakpoint
ALTER TABLE public.practice_session_activity_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY practice_session_activity_events_select_own
  ON public.practice_session_activity_events FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE ALL ON TABLE public.practice_session_activity_events FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.practice_session_activity_events TO authenticated;
