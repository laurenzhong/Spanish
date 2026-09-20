-- The unified YouTube learning workbench publishes the official privacy-enhanced
-- embed. Reconcile an environment-only trigger that incorrectly required every
-- video version to also have a Bunny MP4, which is not part of the YouTube
-- acquisition contract and prevents otherwise valid reviewed embeds from being
-- published. The media_assets expiry/HTTPS checks remain authoritative.
DROP TRIGGER IF EXISTS media_assets_bunny_video_guard ON public.media_assets;
DROP FUNCTION IF EXISTS public.enforce_bunny_video_asset();
