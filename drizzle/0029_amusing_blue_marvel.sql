ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_expiry_policy_check";--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_expiry_policy_check" CHECK ("media_assets"."kind" = 'official_embed' or "media_assets"."provider_key" = 'language-reactor' or "media_assets"."playback_expires_at" is not null);
--> statement-breakpoint
UPDATE "media_assets" AS assets
SET "provider_key" = 'language-reactor', "playback_expires_at" = NULL
FROM "media_versions" AS versions
WHERE assets."media_version_id" = versions."id"
  AND assets."kind" = 'audio'
  AND versions."source_feed_url" = 'https://www.languagereactor.com/c/es/pd/t_pd_mix_es';
