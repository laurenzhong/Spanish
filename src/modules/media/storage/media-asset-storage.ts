import { createClient } from "@supabase/supabase-js";

export const MEDIA_AUDIO_BUCKET = process.env.MEDIA_AUDIO_STORAGE_BUCKET?.trim() || "media-audio";
export const MEDIA_VIDEO_BUCKET = process.env.MEDIA_VIDEO_STORAGE_BUCKET?.trim() || "media-video";
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

export type MediaAssetStorage = Readonly<{
  putAudio(path: string, body: Uint8Array, contentType: string): Promise<{ url: string }>;
  putVideo(path: string, body: Uint8Array, contentType: string): Promise<{ url: string }>;
  remove(path: string, kind?: "audio" | "video"): Promise<void>;
}>;

export function createSupabaseMediaAssetStorage(): MediaAssetStorage | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !secretKey) return null;
  const client = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async putAudio(path, body, contentType) {
      if (body.byteLength <= 0 || body.byteLength > MAX_AUDIO_BYTES) throw new Error("media-audio-too-large");
      await client.storage.createBucket(MEDIA_AUDIO_BUCKET, {
        public: true,
        allowedMimeTypes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "application/ogg"],
      }).catch(() => undefined);
      const { error } = await client.storage.from(MEDIA_AUDIO_BUCKET).upload(path, body, { contentType, upsert: true });
      if (error) throw new Error("media-audio-storage-failed");
      const { data } = client.storage.from(MEDIA_AUDIO_BUCKET).getPublicUrl(path);
      if (!data.publicUrl) throw new Error("media-audio-url-failed");
      return { url: data.publicUrl };
    },
    async putVideo(path, body, contentType) {
      if (body.byteLength <= 0 || body.byteLength > MAX_VIDEO_BYTES) throw new Error("media-video-too-large");
      await client.storage.createBucket(MEDIA_VIDEO_BUCKET, {
        public: true,
        allowedMimeTypes: ["video/mp4", "video/webm", "video/quicktime"],
        fileSizeLimit: MAX_VIDEO_BYTES,
      }).catch(() => undefined);
      const { error } = await client.storage.from(MEDIA_VIDEO_BUCKET).upload(path, body, { contentType, upsert: true });
      if (error) throw new Error("media-video-storage-failed");
      const { data } = client.storage.from(MEDIA_VIDEO_BUCKET).getPublicUrl(path);
      if (!data.publicUrl) throw new Error("media-video-url-failed");
      return { url: data.publicUrl };
    },
    async remove(path, kind = "audio") {
      const bucket = kind === "video" ? MEDIA_VIDEO_BUCKET : MEDIA_AUDIO_BUCKET;
      const { error } = await client.storage.from(bucket).remove([path]);
      if (error) throw new Error("media-audio-storage-failed");
    },
  };
}
