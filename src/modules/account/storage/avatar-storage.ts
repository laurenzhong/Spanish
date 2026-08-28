export type AvatarUpload = Readonly<{ bytes: Uint8Array; contentType: string; attemptId: string }>;
export type AvatarStored = Readonly<{ path: string }>;

export interface AvatarStorage {
  put(userId: string, upload: AvatarUpload): Promise<AvatarStored>;
  remove(path: string): Promise<void>;
  publicUrl(path: string): Promise<string | null>;
}
