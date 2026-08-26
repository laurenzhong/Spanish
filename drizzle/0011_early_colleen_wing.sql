CREATE TABLE "article_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_version_id" uuid NOT NULL,
	"asset_type" text NOT NULL,
	"available" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"license" "content_source_license",
	"attribution" text,
	"copyright_status" text DEFAULT 'unverified' NOT NULL,
	"alt_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_assets_copyright_status_check" CHECK ("article_assets"."copyright_status" in ('unverified', 'cleared', 'restricted'))
);
--> statement-breakpoint
CREATE TABLE "article_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_segments_position_nonnegative_check" CHECK ("article_segments"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "article_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text NOT NULL,
	"source_name" text NOT NULL,
	"author" text,
	"source_url" text,
	"publication_date" text,
	"license" "content_source_license" NOT NULL,
	"attribution" text,
	"license_evidence" text,
	"copyright_status" text DEFAULT 'unverified' NOT NULL,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_sources_copyright_status_check" CHECK ("article_sources"."copyright_status" in ('unverified', 'cleared', 'restricted'))
);
--> statement-breakpoint
CREATE TABLE "article_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"curated_at" timestamp with time zone,
	"content_hash" text NOT NULL,
	"cefr_level" text NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"region" text NOT NULL,
	"register" text NOT NULL,
	"format" text NOT NULL,
	"estimated_reading_minutes" integer NOT NULL,
	"assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_expression_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_goal_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_tag_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"oral_transfer_type" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"change_reason" text,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_versions_version_positive_check" CHECK ("article_versions"."version" > 0),
	CONSTRAINT "article_versions_estimated_minutes_positive_check" CHECK ("article_versions"."estimated_reading_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_assets" ADD CONSTRAINT "article_assets_article_version_id_article_versions_id_fk" FOREIGN KEY ("article_version_id") REFERENCES "public"."article_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_segments" ADD CONSTRAINT "article_segments_article_version_id_article_versions_id_fk" FOREIGN KEY ("article_version_id") REFERENCES "public"."article_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_source_id_article_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."article_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_assets_version_type_uidx" ON "article_assets" USING btree ("article_version_id","asset_type");--> statement-breakpoint
CREATE UNIQUE INDEX "article_segments_version_position_uidx" ON "article_segments" USING btree ("article_version_id","position");--> statement-breakpoint
CREATE INDEX "article_sources_license_idx" ON "article_sources" USING btree ("license","copyright_status");--> statement-breakpoint
CREATE UNIQUE INDEX "article_versions_article_version_uidx" ON "article_versions" USING btree ("article_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "article_versions_content_hash_uidx" ON "article_versions" USING btree ("article_id","version","content_hash");--> statement-breakpoint
CREATE INDEX "article_versions_status_cefr_idx" ON "article_versions" USING btree ("status","cefr_level");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_stable_key_uidx" ON "articles" USING btree ("stable_key");
--> statement-breakpoint
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY articles_public_read
  ON public.articles FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.article_versions
    WHERE article_versions.article_id = articles.id
      AND article_versions.status = 'published'
      AND public.is_content_approved('article', article_versions.id)
  ));
--> statement-breakpoint
CREATE POLICY article_versions_public_read
  ON public.article_versions FOR SELECT TO anon, authenticated
  USING (status = 'published' AND public.is_content_approved('article', id));
--> statement-breakpoint
CREATE POLICY article_sources_public_read
  ON public.article_sources FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.article_versions
    WHERE article_versions.source_id = article_sources.id
      AND article_versions.status = 'published'
      AND public.is_content_approved('article', article_versions.id)
  ));
--> statement-breakpoint
CREATE POLICY article_segments_public_read
  ON public.article_segments FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.article_versions
    WHERE article_versions.id = article_segments.article_version_id
      AND article_versions.status = 'published'
      AND public.is_content_approved('article', article_versions.id)
  ));
--> statement-breakpoint
CREATE POLICY article_assets_public_read
  ON public.article_assets FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.article_versions
    WHERE article_versions.id = article_assets.article_version_id
      AND article_versions.status = 'published'
      AND public.is_content_approved('article', article_versions.id)
  ));
--> statement-breakpoint
REVOKE ALL ON TABLE public.articles, public.article_sources, public.article_versions, public.article_segments, public.article_assets FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.articles, public.article_sources, public.article_versions, public.article_segments, public.article_assets TO anon, authenticated;
