CREATE TABLE "user_generated_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_version_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"cefr" text NOT NULL,
	"length" text NOT NULL,
	"format" text NOT NULL,
	"keywords" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"provider" text NOT NULL,
	"model_version" text NOT NULL,
	"provider_request_id" text,
	"request_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_generated_articles_prompt_length_check" CHECK (char_length("user_generated_articles"."prompt") between 1 and 500),
	CONSTRAINT "user_generated_articles_cefr_check" CHECK ("user_generated_articles"."cefr" in ('A1', 'A2', 'B1', 'B2')),
	CONSTRAINT "user_generated_articles_length_check" CHECK ("user_generated_articles"."length" in ('short', 'medium', 'long')),
	CONSTRAINT "user_generated_articles_format_check" CHECK ("user_generated_articles"."format" in ('story', 'dialogue', 'guide')),
	CONSTRAINT "user_generated_articles_status_check" CHECK ("user_generated_articles"."status" = 'ready')
);
--> statement-breakpoint
ALTER TABLE "user_generated_articles" ADD CONSTRAINT "user_generated_articles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_generated_articles" ADD CONSTRAINT "user_generated_articles_article_version_id_article_versions_id_fk" FOREIGN KEY ("article_version_id") REFERENCES "public"."article_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_generated_articles_article_version_uidx" ON "user_generated_articles" USING btree ("article_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_generated_articles_user_idempotency_uidx" ON "user_generated_articles" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "user_generated_articles_user_created_idx" ON "user_generated_articles" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE public.user_generated_articles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_generated_articles_select_own
  ON public.user_generated_articles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY user_generated_articles_insert_own
  ON public.user_generated_articles FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY user_generated_articles_delete_own
  ON public.user_generated_articles FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE ALL ON TABLE public.user_generated_articles FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE public.user_generated_articles TO authenticated;
