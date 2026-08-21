CREATE TABLE "content_bundle_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stable_key" text NOT NULL,
	"bundle_version" integer NOT NULL,
	"schema_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"entity_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_bundle_imports_version_positive_check" CHECK ("content_bundle_imports"."bundle_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "content_sources" ADD COLUMN "copyright_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_sources" ADD COLUMN "review_notes" text;--> statement-breakpoint
ALTER TABLE "expression_tags" ADD COLUMN "scoring" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "content_bundle_imports_stable_version_uidx" ON "content_bundle_imports" USING btree ("stable_key","bundle_version");--> statement-breakpoint
CREATE INDEX "content_bundle_imports_imported_at_idx" ON "content_bundle_imports" USING btree ("imported_at");--> statement-breakpoint
ALTER TABLE "content_sources" ADD CONSTRAINT "content_sources_copyright_status_check" CHECK ("content_sources"."copyright_status" in ('unverified', 'cleared', 'restricted'));
--> statement-breakpoint
ALTER TABLE public.content_bundle_imports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.content_bundle_imports FROM anon, authenticated;
--> statement-breakpoint
REVOKE SELECT ON TABLE public.content_sources FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT (
  id,
  content_pack_id,
  source_type,
  title,
  author,
  source_url,
  license,
  attribution,
  copyright_status,
  created_at,
  updated_at
) ON public.content_sources TO anon, authenticated;
