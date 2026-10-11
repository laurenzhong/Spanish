import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

import type { MediaArtwork } from "../domain";

const BUCKET = "media-artwork";
const MAX_BYTES = 5 * 1024 * 1024;
const CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type MediaArtworkStorage = Readonly<{
  snapshot(input: Readonly<{ stableKey: string; revision: number; artwork: MediaArtwork }>): Promise<MediaArtwork>;
}>;

export function createSupabaseMediaArtworkStorage(): MediaArtworkStorage | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async snapshot(input) {
      let response: Response;
      try {
        response = await fetch(new URL(input.artwork.url), { signal: AbortSignal.timeout(15_000), headers: { accept: "image/avif,image/webp,image/jpeg,image/png" } });
      } catch (error) {
        throw new Error(`MEDIA_ARTWORK_FETCH_FAILED:${error instanceof Error ? error.message : "unknown"}`);
      }
      if (!response.ok) throw new Error("MEDIA_ARTWORK_FETCH_FAILED");
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
      if (!CONTENT_TYPES.has(contentType)) throw new Error("MEDIA_ARTWORK_TYPE_INVALID");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) throw new Error("MEDIA_ARTWORK_SIZE_INVALID");
      const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
      const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
      const path = `${input.stableKey}/${input.revision}-${digest}.${extension}`;
      await client.storage.createBucket(BUCKET, { public: true, fileSizeLimit: String(MAX_BYTES), allowedMimeTypes: [...CONTENT_TYPES] }).catch(() => undefined);
      const { error } = await client.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`MEDIA_ARTWORK_UPLOAD_FAILED:${error.message}`);
      return { ...input.artwork, url: client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, expiresAt: null };
    },
  };
}
