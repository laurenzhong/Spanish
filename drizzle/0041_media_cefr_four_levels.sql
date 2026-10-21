-- Media CEFR becomes a four-level scale (A1/A2/B1/B2) so the learning library can
-- classify and filter beginner and lower-intermediate content the same way the
-- article, scenario and generated-story surfaces already do.
ALTER TABLE "media_versions" DROP CONSTRAINT "media_versions_cefr_check";--> statement-breakpoint
ALTER TABLE "media_versions" ADD CONSTRAINT "media_versions_cefr_check" CHECK ("media_versions"."cefr" is null or "media_versions"."cefr" in ('A1', 'A2', 'B1', 'B2'));--> statement-breakpoint