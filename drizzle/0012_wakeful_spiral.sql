CREATE TYPE "public"."reading_item_type" AS ENUM('phrase', 'highlight');--> statement-breakpoint
CREATE TYPE "public"."reading_progress_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."saved_article_source_status" AS ENUM('saved', 'blocked');--> statement-breakpoint
CREATE TABLE "user_article_highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_version_id" uuid NOT NULL,
	"item_type" "reading_item_type" NOT NULL,
	"segment_position" integer NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_article_highlights_position_nonnegative_check" CHECK ("user_article_highlights"."segment_position" >= 0),
	CONSTRAINT "user_article_highlights_text_length_check" CHECK (char_length("user_article_highlights"."text") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "user_article_saves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_reading_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"article_version_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "reading_progress_status" DEFAULT 'in_progress' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"last_opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_reading_progress_position_nonnegative_check" CHECK ("user_reading_progress"."position" >= 0),
	CONSTRAINT "user_reading_progress_note_length_check" CHECK (char_length("user_reading_progress"."note") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "user_saved_article_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"title" text,
	"author" text,
	"source_name" text,
	"license" "content_source_license",
	"copyright_status" text DEFAULT 'unverified' NOT NULL,
	"status" "saved_article_source_status" DEFAULT 'saved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_saved_article_sources_copyright_status_check" CHECK ("user_saved_article_sources"."copyright_status" in ('unverified', 'cleared', 'restricted')),
	CONSTRAINT "user_saved_article_sources_url_length_check" CHECK (char_length("user_saved_article_sources"."source_url") <= 2048)
);
--> statement-breakpoint
ALTER TABLE "user_article_highlights" ADD CONSTRAINT "user_article_highlights_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_article_highlights" ADD CONSTRAINT "user_article_highlights_article_version_id_article_versions_id_fk" FOREIGN KEY ("article_version_id") REFERENCES "public"."article_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_article_saves" ADD CONSTRAINT "user_article_saves_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_article_saves" ADD CONSTRAINT "user_article_saves_article_version_id_article_versions_id_fk" FOREIGN KEY ("article_version_id") REFERENCES "public"."article_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reading_progress" ADD CONSTRAINT "user_reading_progress_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_reading_progress" ADD CONSTRAINT "user_reading_progress_article_version_id_article_versions_id_fk" FOREIGN KEY ("article_version_id") REFERENCES "public"."article_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_saved_article_sources" ADD CONSTRAINT "user_saved_article_sources_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_article_highlights_identity_uidx" ON "user_article_highlights" USING btree ("user_id","article_version_id","item_type","segment_position","text");--> statement-breakpoint
CREATE INDEX "user_article_highlights_user_article_idx" ON "user_article_highlights" USING btree ("user_id","article_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_article_saves_user_article_uidx" ON "user_article_saves" USING btree ("user_id","article_version_id");--> statement-breakpoint
CREATE INDEX "user_article_saves_user_created_idx" ON "user_article_saves" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_reading_progress_user_article_uidx" ON "user_reading_progress" USING btree ("user_id","article_version_id");--> statement-breakpoint
CREATE INDEX "user_reading_progress_user_last_opened_idx" ON "user_reading_progress" USING btree ("user_id","last_opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_saved_article_sources_user_url_uidx" ON "user_saved_article_sources" USING btree ("user_id","normalized_url");--> statement-breakpoint
CREATE INDEX "user_saved_article_sources_user_created_idx" ON "user_saved_article_sources" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE public.user_reading_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_article_saves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_article_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_saved_article_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_reading_progress_select_own
  ON public.user_reading_progress FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_reading_progress_insert_own
  ON public.user_reading_progress FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_reading_progress_update_own
  ON public.user_reading_progress FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_reading_progress_delete_own
  ON public.user_reading_progress FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY user_article_saves_select_own
  ON public.user_article_saves FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_article_saves_insert_own
  ON public.user_article_saves FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_article_saves_delete_own
  ON public.user_article_saves FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY user_article_highlights_select_own
  ON public.user_article_highlights FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_article_highlights_insert_own
  ON public.user_article_highlights FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_article_highlights_delete_own
  ON public.user_article_highlights FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY user_saved_article_sources_select_own
  ON public.user_saved_article_sources FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY user_saved_article_sources_insert_own
  ON public.user_saved_article_sources FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_saved_article_sources_update_own
  ON public.user_saved_article_sources FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY user_saved_article_sources_delete_own
  ON public.user_saved_article_sources FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE ALL ON TABLE
  public.user_reading_progress,
  public.user_article_saves,
  public.user_article_highlights,
  public.user_saved_article_sources
FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.user_reading_progress,
  public.user_article_saves,
  public.user_article_highlights,
  public.user_saved_article_sources
TO authenticated;
