CREATE TABLE "learning_observation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"source_module" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text,
	"subject_version" integer,
	"signal_strength" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedupe_key" text NOT NULL,
	"algorithm_version" text NOT NULL,
	"retention_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_observation_events_event_type_check" CHECK ("learning_observation_events"."event_type" in ('media_exposure', 'reading_exposure', 'lookup', 'selection_explanation', 'assistant_intent', 'lexical_assessment', 'replay')),
	CONSTRAINT "learning_observation_events_source_module_check" CHECK ("learning_observation_events"."source_module" in ('media', 'reading', 'lexicon-corpus', 'conversation', 'training')),
	CONSTRAINT "learning_observation_events_subject_type_check" CHECK ("learning_observation_events"."subject_type" in ('lexeme', 'phrase', 'content_segment', 'skill', 'none')),
	CONSTRAINT "learning_observation_events_signal_strength_check" CHECK ("learning_observation_events"."signal_strength" in ('exposure', 'weak', 'moderate', 'strong')),
	CONSTRAINT "learning_observation_events_subject_link_check" CHECK ("learning_observation_events"."subject_type" = 'none' and "learning_observation_events"."subject_id" is null or "learning_observation_events"."subject_type" <> 'none' and "learning_observation_events"."subject_id" is not null),
	CONSTRAINT "learning_observation_events_subject_version_check" CHECK ("learning_observation_events"."subject_version" is null or "learning_observation_events"."subject_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "learning_insights_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "record_assistant_learning_intent" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "learning_observation_events" ADD CONSTRAINT "learning_observation_events_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_observation_events_user_dedupe_uidx" ON "learning_observation_events" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "learning_observation_events_user_occurred_idx" ON "learning_observation_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "learning_observation_events_user_type_occurred_idx" ON "learning_observation_events" USING btree ("user_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "learning_observation_events_retention_idx" ON "learning_observation_events" USING btree ("retention_until");
--> statement-breakpoint
-- Learning observations are private, append-only application data. The server
-- uses its trusted database role to append and query observations; authenticated
-- clients may only read their own rows through the existing Supabase session.
ALTER TABLE public.learning_observation_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY learning_observation_events_select_own
ON public.learning_observation_events FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE ALL ON TABLE public.learning_observation_events FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.learning_observation_events TO authenticated;
