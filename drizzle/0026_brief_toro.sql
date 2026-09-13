ALTER TABLE "media_versions" ADD COLUMN "source_feed_url" text;--> statement-breakpoint
ALTER TABLE "media_versions" ADD COLUMN "enclosure_url_hash" text;--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_source_feed_url_check" CHECK ("media_versions"."source_feed_url" is null or "media_versions"."source_feed_url" ~ '^https://');--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_enclosure_url_hash_check" CHECK ("media_versions"."enclosure_url_hash" is null or "media_versions"."enclosure_url_hash" ~ '^[a-f0-9]{64}$');