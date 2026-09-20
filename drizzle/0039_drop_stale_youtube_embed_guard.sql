-- A target environment recreated this legacy trigger after 0038 was recorded.
-- Keep the official YouTube embed contract independent from optional Bunny MP4s.
DROP TRIGGER IF EXISTS media_assets_bunny_video_guard ON public.media_assets;
DROP FUNCTION IF EXISTS public.enforce_bunny_video_asset();
