CREATE TABLE "learning_insight_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."profiles"("id") ON DELETE cascade,
  "local_date" date NOT NULL,
  "timezone" text NOT NULL,
  "report_version" integer NOT NULL,
  "status" text NOT NULL,
  "coverage" jsonb NOT NULL,
  "summary" text NOT NULL,
  "candidates" jsonb NOT NULL,
  "source_event_ids" jsonb NOT NULL,
  "generation_id" text NOT NULL,
  "algorithm_version" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "learning_insight_reports_status_check" CHECK ("status" in ('generated', 'insufficient_data', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "learning_insight_reports_user_date_version_uidx" ON "learning_insight_reports" USING btree ("user_id", "local_date", "report_version");
CREATE INDEX "learning_insight_reports_user_date_idx" ON "learning_insight_reports" USING btree ("user_id", "local_date");
--> statement-breakpoint
CREATE TABLE "learning_insight_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."profiles"("id") ON DELETE cascade,
  "report_id" uuid NOT NULL REFERENCES "public"."learning_insight_reports"("id") ON DELETE cascade,
  "candidate_key" text NOT NULL,
  "feedback" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "learning_insight_feedback_value_check" CHECK ("feedback" in ('mastered', 'not_relevant', 'review_again'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "learning_insight_feedback_user_report_candidate_dedupe_uidx" ON "learning_insight_feedback" USING btree ("user_id", "report_id", "candidate_key", "dedupe_key");
CREATE INDEX "learning_insight_feedback_user_report_idx" ON "learning_insight_feedback" USING btree ("user_id", "report_id");
--> statement-breakpoint
ALTER TABLE public.learning_insight_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_insight_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY learning_insight_reports_select_own ON public.learning_insight_reports FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY learning_insight_feedback_select_own ON public.learning_insight_feedback FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY learning_insight_feedback_insert_own ON public.learning_insight_feedback FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
REVOKE ALL ON TABLE public.learning_insight_reports, public.learning_insight_feedback FROM anon, authenticated;
GRANT SELECT ON TABLE public.learning_insight_reports, public.learning_insight_feedback TO authenticated;
GRANT INSERT ON TABLE public.learning_insight_feedback TO authenticated;
