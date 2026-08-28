import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";

import type { AvatarStorage, AvatarUpload, AvatarStored } from "./avatar-storage";

const BUCKET = "profile-avatars";
const MAX_BYTES = 8 * 1024 * 1024;

export function normalizeAvatar(bytes: Uint8Array): Promise<Buffer> {
  if (bytes.byteLength > MAX_BYTES) return Promise.reject(new Error("avatar-too-large"));
  return sharp(bytes).rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 88 }).toBuffer();
}

export function createSupabaseAvatarStorage(): AvatarStorage | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !secretKey) return null;
  const client = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async put(userId: string, upload: AvatarUpload): Promise<AvatarStored> {
      // Keep local/self-hosted projects usable even when the bucket was not
      // provisioned yet. A secret key is required for this server-only call.
      await client.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: `${MAX_BYTES}`,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
      }).catch(() => undefined);
      const ownerHash = createHash("sha256").update(userId).digest("hex").slice(0, 24);
      const path = `${ownerHash}/${randomUUID()}.webp`;
      const normalized = await normalizeAvatar(upload.bytes);
      const { error } = await client.storage.from(BUCKET).upload(path, normalized, { contentType: "image/webp", upsert: false });
      if (error) throw new Error("avatar-storage-failed");
      return { path };
    },
    async remove(path) {
      const { error } = await client.storage.from(BUCKET).remove([path]);
      if (error) throw new Error("avatar-storage-failed");
    },
    async cleanup(userId, keepPath) {
      const ownerHash = createHash("sha256").update(userId).digest("hex").slice(0, 24);
      const { data, error } = await client.storage.from(BUCKET).list(ownerHash, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
      if (error || !data) return;
      const stale = data.map((entry) => `${ownerHash}/${entry.name}`).filter((path) => path !== keepPath);
      if (stale.length > 0) await client.storage.from(BUCKET).remove(stale);
    },
    async publicUrl(path) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      return error ? null : data.signedUrl;
    },
  };
}
