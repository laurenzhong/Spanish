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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) return null;
  const client = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return {
    async put(userId: string, upload: AvatarUpload): Promise<AvatarStored> {
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
    async publicUrl(path) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      return error ? null : data.signedUrl;
    },
  };
}
