CREATE TABLE "personal_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_scenario_id" uuid,
	"idempotency_key" text NOT NULL,
	"title" text NOT NULL,
	"cefr" text NOT NULL,
	"region" text NOT NULL,
	"skeleton" jsonb NOT NULL,
	"source_type" text NOT NULL,
	"source_reference" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_version" text,
	"selected_expressions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"communication_goals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"condition_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_key" text NOT NULL,
	"model_version" text NOT NULL,
	"generation_version" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_scenarios_cefr_check" CHECK ("personal_scenarios"."cefr" in ('A1', 'A2', 'B1', 'B2')),
	CONSTRAINT "personal_scenarios_status_check" CHECK ("personal_scenarios"."status" in ('ready', 'archived')),
	CONSTRAINT "personal_scenarios_source_type_check" CHECK ("personal_scenarios"."source_type" in ('topic', 'reading', 'saved-expression', 'recent-error'))
);
--> statement-breakpoint
CREATE TABLE "scenario_repetition_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_session_id" uuid NOT NULL,
	"source_scenario_id" uuid,
	"personal_scenario_id" uuid,
	"expression_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goal_snapshot" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"interval_step" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_result" text,
	"variant_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"completion_key" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_repetition_items_step_check" CHECK ("scenario_repetition_items"."interval_step" between 0 and 3),
	CONSTRAINT "scenario_repetition_items_status_check" CHECK ("scenario_repetition_items"."status" in ('pending', 'completed', 'skipped')),
	CONSTRAINT "scenario_repetition_items_result_check" CHECK ("scenario_repetition_items"."last_result" is null or "scenario_repetition_items"."last_result" in ('contextual-success', 'needs-work', 'technical-failure'))
);
--> statement-breakpoint
CREATE TABLE "scenario_session_states" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"personal_scenario_id" uuid,
	"client_attempt_id" text NOT NULL,
	"temporary_character" jsonb NOT NULL,
	"communication_goal" text NOT NULL,
	"triggered_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_turn" integer DEFAULT 0 NOT NULL,
	"generation_id" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"stable_status" text DEFAULT 'awaiting-expression' NOT NULL,
	"hint_level" integer DEFAULT 0 NOT NULL,
	"transcript_draft" text,
	"transcript_draft_expires_at" timestamp with time zone,
	"review_status" text DEFAULT 'not-requested' NOT NULL,
	"completion_idempotency_key" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_session_states_revision_positive_check" CHECK ("scenario_session_states"."revision" > 0),
	CONSTRAINT "scenario_session_states_turn_nonnegative_check" CHECK ("scenario_session_states"."current_turn" >= 0),
	CONSTRAINT "scenario_session_states_hint_level_check" CHECK ("scenario_session_states"."hint_level" between 0 and 3),
	CONSTRAINT "scenario_session_states_stable_status_check" CHECK ("scenario_session_states"."stable_status" in ('preparing', 'awaiting-expression', 'awaiting-transcript-confirmation', 'paused', 'recoverable-error', 'completed', 'review-pending', 'review-ready')),
	CONSTRAINT "scenario_session_states_review_status_check" CHECK ("scenario_session_states"."review_status" in ('not-requested', 'pending', 'ready', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "scenario_turn_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"communication_success" boolean,
	"error_spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"natural_alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hint_level" integer DEFAULT 0 NOT NULL,
	"transcript_confidence" real,
	"algorithm_version" text NOT NULL,
	"provider_key" text,
	"model_version" text,
	"provider_request_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_turn_reviews_hint_level_check" CHECK ("scenario_turn_reviews"."hint_level" between 0 and 3),
	CONSTRAINT "scenario_turn_reviews_confidence_check" CHECK ("scenario_turn_reviews"."transcript_confidence" is null or ("scenario_turn_reviews"."transcript_confidence" between 0 and 1)),
	CONSTRAINT "scenario_turn_reviews_status_check" CHECK ("scenario_turn_reviews"."status" in ('pending', 'ready', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "scenario_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"client_attempt_id" text NOT NULL,
	"turn_index" integer NOT NULL,
	"speaker" text NOT NULL,
	"modality" text NOT NULL,
	"text" text NOT NULL,
	"status" text NOT NULL,
	"attempt_id" text,
	"generation_id" text,
	"reply_to_turn_id" uuid,
	"provider_call_id" uuid,
	"provider_key" text,
	"model_version" text,
	"provider_request_id" text,
	"completed_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenario_turns_position_nonnegative_check" CHECK ("scenario_turns"."turn_index" >= 0),
	CONSTRAINT "scenario_turns_speaker_check" CHECK ("scenario_turns"."speaker" in ('user', 'temporary-character', 'condition')),
	CONSTRAINT "scenario_turns_modality_check" CHECK ("scenario_turns"."modality" in ('speech', 'typing', 'system')),
	CONSTRAINT "scenario_turns_status_check" CHECK ("scenario_turns"."status" in ('pending', 'completed', 'stopped', 'failed')),
	CONSTRAINT "scenario_turns_text_length_check" CHECK (char_length("scenario_turns"."text") between 1 and 4000),
	CONSTRAINT "scenario_turns_completed_at_check" CHECK (("scenario_turns"."status" = 'completed' and "scenario_turns"."completed_at" is not null) or ("scenario_turns"."status" <> 'completed' and "scenario_turns"."completed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "user_provider_preferences" (
	"user_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"provider_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_provider_preferences_user_id_capability_pk" PRIMARY KEY("user_id","capability"),
	CONSTRAINT "user_provider_preferences_capability_check" CHECK ("user_provider_preferences"."capability" in ('scenario-generation', 'scenario-roleplay', 'scenario-evaluation', 'transcription', 'pronunciation'))
);
--> statement-breakpoint
CREATE TABLE "user_saved_expressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"expression_id" uuid,
	"client_save_id" text NOT NULL,
	"source_text" text NOT NULL,
	"translation" text,
	"register" text,
	"usage_notes" text,
	"source_type" text NOT NULL,
	"source_entity_id" text,
	"source_version" text,
	"content_hash" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_saved_expressions_text_length_check" CHECK (char_length("user_saved_expressions"."source_text") between 1 and 1000),
	CONSTRAINT "user_saved_expressions_source_type_check" CHECK ("user_saved_expressions"."source_type" in ('formal-expression', 'reading-selection', 'scenario-review', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "practice_sessions_id_user_uidx" ON "practice_sessions" USING btree ("id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "personal_scenarios_id_user_uidx" ON "personal_scenarios" USING btree ("id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_turns_id_user_uidx" ON "scenario_turns" USING btree ("id","user_id");
--> statement-breakpoint
ALTER TABLE "personal_scenarios" ADD CONSTRAINT "personal_scenarios_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_scenarios" ADD CONSTRAINT "personal_scenarios_source_scenario_id_scenarios_id_fk" FOREIGN KEY ("source_scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_repetition_items" ADD CONSTRAINT "scenario_repetition_items_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_repetition_items" ADD CONSTRAINT "scenario_repetition_items_source_scenario_id_scenarios_id_fk" FOREIGN KEY ("source_scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_repetition_items" ADD CONSTRAINT "scenario_repetition_items_session_user_fk" FOREIGN KEY ("source_session_id","user_id") REFERENCES "public"."practice_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_repetition_items" ADD CONSTRAINT "scenario_repetition_items_personal_scenario_user_fk" FOREIGN KEY ("personal_scenario_id","user_id") REFERENCES "public"."personal_scenarios"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_session_states" ADD CONSTRAINT "scenario_session_states_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_session_states" ADD CONSTRAINT "scenario_session_states_session_user_fk" FOREIGN KEY ("session_id","user_id") REFERENCES "public"."practice_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_session_states" ADD CONSTRAINT "scenario_session_states_personal_scenario_user_fk" FOREIGN KEY ("personal_scenario_id","user_id") REFERENCES "public"."personal_scenarios"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_turn_reviews" ADD CONSTRAINT "scenario_turn_reviews_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_turn_reviews" ADD CONSTRAINT "scenario_turn_reviews_turn_user_fk" FOREIGN KEY ("turn_id","user_id") REFERENCES "public"."scenario_turns"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_turns" ADD CONSTRAINT "scenario_turns_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_turns" ADD CONSTRAINT "scenario_turns_provider_call_id_provider_calls_id_fk" FOREIGN KEY ("provider_call_id") REFERENCES "public"."provider_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_turns" ADD CONSTRAINT "scenario_turns_session_user_fk" FOREIGN KEY ("session_id","user_id") REFERENCES "public"."practice_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_turns" ADD CONSTRAINT "scenario_turns_reply_to_user_fk" FOREIGN KEY ("reply_to_turn_id","user_id") REFERENCES "public"."scenario_turns"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_provider_preferences" ADD CONSTRAINT "user_provider_preferences_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_saved_expressions" ADD CONSTRAINT "user_saved_expressions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_saved_expressions" ADD CONSTRAINT "user_saved_expressions_expression_id_expressions_id_fk" FOREIGN KEY ("expression_id") REFERENCES "public"."expressions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_scenarios_user_idempotency_uidx" ON "personal_scenarios" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "personal_scenarios_user_created_idx" ON "personal_scenarios" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_repetition_items_user_idempotency_uidx" ON "scenario_repetition_items" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "scenario_repetition_items_user_due_idx" ON "scenario_repetition_items" USING btree ("user_id","status","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_session_states_user_client_attempt_uidx" ON "scenario_session_states" USING btree ("user_id","client_attempt_id");--> statement-breakpoint
CREATE INDEX "scenario_session_states_user_updated_idx" ON "scenario_session_states" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_turn_reviews_turn_uidx" ON "scenario_turn_reviews" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "scenario_turn_reviews_user_created_idx" ON "scenario_turn_reviews" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_turns_user_client_attempt_uidx" ON "scenario_turns" USING btree ("user_id","client_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_turns_session_position_uidx" ON "scenario_turns" USING btree ("session_id","turn_index");--> statement-breakpoint
CREATE INDEX "scenario_turns_user_session_idx" ON "scenario_turns" USING btree ("user_id","session_id");--> statement-breakpoint
CREATE INDEX "user_provider_preferences_user_idx" ON "user_provider_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_saved_expressions_user_client_uidx" ON "user_saved_expressions" USING btree ("user_id","client_save_id");--> statement-breakpoint
CREATE INDEX "user_saved_expressions_user_created_idx" ON "user_saved_expressions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE FUNCTION public.ensure_scenario_review_targets_completed_user_turn()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.scenario_turns
    WHERE id = NEW.turn_id
      AND user_id = NEW.user_id
      AND speaker = 'user'
      AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'scenario review requires an owned completed user turn';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scenario_turn_reviews_completed_user_turn
BEFORE INSERT OR UPDATE OF turn_id, user_id ON public.scenario_turn_reviews
FOR EACH ROW EXECUTE FUNCTION public.ensure_scenario_review_targets_completed_user_turn();
--> statement-breakpoint
ALTER TABLE public.user_saved_expressions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.personal_scenarios ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.scenario_session_states ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.scenario_turns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.scenario_turn_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.scenario_repetition_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.user_provider_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_saved_expressions_own ON public.user_saved_expressions FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY personal_scenarios_own ON public.personal_scenarios FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY scenario_session_states_own ON public.scenario_session_states FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY scenario_turns_own ON public.scenario_turns FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY scenario_turn_reviews_own ON public.scenario_turn_reviews FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY scenario_repetition_items_own ON public.scenario_repetition_items FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY user_provider_preferences_own ON public.user_provider_preferences FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE ALL ON TABLE public.user_saved_expressions, public.personal_scenarios,
  public.scenario_session_states, public.scenario_turns, public.scenario_turn_reviews,
  public.scenario_repetition_items, public.user_provider_preferences FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_saved_expressions,
  public.personal_scenarios, public.scenario_session_states, public.scenario_turns,
  public.scenario_turn_reviews, public.scenario_repetition_items,
  public.user_provider_preferences TO authenticated;
