CREATE TYPE "public"."media_artwork_source" AS ENUM('youtube', 'podcast-feed', 'fallback');--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "artwork_url" text;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "artwork_alt" text;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "artwork_source" "media_artwork_source";--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "artwork_width" integer;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "artwork_height" integer;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "artwork_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_artwork_url_check" CHECK ("media_versions"."artwork_url" is null or "media_versions"."artwork_url" ~ '^https://');--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_artwork_fields_check" CHECK (("media_versions"."artwork_url" is null and "media_versions"."artwork_alt" is null and "media_versions"."artwork_source" is null and "media_versions"."artwork_width" is null and "media_versions"."artwork_height" is null and "media_versions"."artwork_expires_at" is null) or ("media_versions"."artwork_url" is not null and "media_versions"."artwork_alt" is not null and "media_versions"."artwork_source" is not null and (("media_versions"."artwork_width" is null and "media_versions"."artwork_height" is null) or ("media_versions"."artwork_width" > 0 and "media_versions"."artwork_height" > 0))));