CREATE TABLE "lexical_assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"assessment_item_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"answer" text NOT NULL,
	"normalized_answer" text NOT NULL,
	"score" integer NOT NULL,
	"passed" boolean NOT NULL,
	"input_mode" text DEFAULT 'typing' NOT NULL,
	"algorithm_version" text NOT NULL,
	"content_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexical_assessment_attempts_score_check" CHECK ("lexical_assessment_attempts"."score" in (0, 1)),
	CONSTRAINT "lexical_assessment_attempts_input_mode_check" CHECK ("lexical_assessment_attempts"."input_mode" = 'typing'),
	CONSTRAINT "lexical_assessment_attempts_content_version_check" CHECK ("lexical_assessment_attempts"."content_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "lexical_assessment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"entry_kind" text NOT NULL,
	"entry_id" uuid,
	"prompt_type" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_reference" jsonb NOT NULL,
	"skill_key" text NOT NULL,
	"content_version" integer NOT NULL,
	"owner_user_id" uuid,
	"status" text DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lexical_assessment_items_version_positive_check" CHECK ("lexical_assessment_items"."version" > 0),
	CONSTRAINT "lexical_assessment_items_kind_check" CHECK ("lexical_assessment_items"."entry_kind" in ('lexeme', 'phrase')),
	CONSTRAINT "lexical_assessment_items_prompt_type_check" CHECK ("lexical_assessment_items"."prompt_type" in ('choice', 'judgement', 'cloze', 'recall')),
	CONSTRAINT "lexical_assessment_items_skill_check" CHECK ("lexical_assessment_items"."skill_key" like 'lexical.%'),
	CONSTRAINT "lexical_assessment_items_content_version_check" CHECK ("lexical_assessment_items"."content_version" > 0),
	CONSTRAINT "lexical_assessment_items_status_check" CHECK ("lexical_assessment_items"."status" in ('published', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "lexical_assessment_attempts" ADD CONSTRAINT "lexical_assessment_attempts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexical_assessment_attempts" ADD CONSTRAINT "lexical_assessment_attempts_assessment_item_id_lexical_assessment_items_id_fk" FOREIGN KEY ("assessment_item_id") REFERENCES "public"."lexical_assessment_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lexical_assessment_items" ADD CONSTRAINT "lexical_assessment_items_owner_user_id_profiles_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lexical_assessment_attempts_user_idempotency_uidx" ON "lexical_assessment_attempts" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "lexical_assessment_attempts_user_item_idx" ON "lexical_assessment_attempts" USING btree ("user_id","assessment_item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lexical_assessment_items_key_version_uidx" ON "lexical_assessment_items" USING btree ("assessment_key","version");--> statement-breakpoint
CREATE INDEX "lexical_assessment_items_visibility_idx" ON "lexical_assessment_items" USING btree ("owner_user_id","status");
--> statement-breakpoint
ALTER TABLE public.lexical_assessment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lexical_assessment_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lexical_assessment_items, public.lexical_assessment_attempts FROM anon, authenticated;
--> statement-breakpoint
CREATE POLICY lexical_assessment_items_public_or_own_read ON public.lexical_assessment_items
  FOR SELECT TO anon, authenticated
  USING ((owner_user_id is null and status = 'published') or owner_user_id = (SELECT auth.uid()));
CREATE POLICY lexical_assessment_attempts_own ON public.lexical_assessment_attempts
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY lexical_assessment_attempts_own_insert ON public.lexical_assessment_attempts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
GRANT SELECT ON TABLE public.lexical_assessment_items TO anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.lexical_assessment_attempts TO authenticated;
