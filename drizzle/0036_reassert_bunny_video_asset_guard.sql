CREATE OR REPLACE FUNCTION public.enforce_bunny_video_asset()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.media_versions versions
    JOIN public.media_items items ON items.id = versions.media_item_id
    WHERE versions.id = NEW.media_version_id
      AND items.kind = 'video'
      AND (NEW.kind <> 'video' OR NEW.provider_key <> 'bunny-storage' OR NEW.mime_type <> 'video/mp4')
  ) THEN
    RAISE EXCEPTION 'VIDEO_ASSET_MUST_USE_BUNNY_MP4';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS media_assets_bunny_video_guard ON public.media_assets;
--> statement-breakpoint
CREATE TRIGGER media_assets_bunny_video_guard
BEFORE INSERT OR UPDATE OF media_version_id, kind, provider_key, mime_type
ON public.media_assets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_bunny_video_asset();
