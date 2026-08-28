import type { AccountRepository } from "../repositories";
import type { AvatarStorage } from "../storage";
import { getAccountProfile } from "./get-account-profile";

export async function uploadAvatar(repository: AccountRepository, storage: AvatarStorage, userId: string, bytes: Uint8Array, contentType: string, attemptId: string) {
  const current = await repository.get(userId);
  if (!current) return { kind: "not-found" as const };
  const stored = await storage.put(userId, { bytes, contentType, attemptId });
  const updated = await repository.update(userId, { avatarKind: "upload", avatarPresetId: null, avatarPath: stored.path, expectedUpdatedAt: current.updatedAt });
  if (updated === "conflict" || !updated) {
    await storage.remove(stored.path).catch(() => undefined);
    return { kind: "conflict" as const };
  }
  if (current.avatarPath && current.avatarPath !== stored.path) await storage.remove(current.avatarPath).catch(() => undefined);
  if (storage.cleanup) await storage.cleanup(userId, stored.path).catch(() => undefined);
  return { kind: "ok" as const, profile: await getAccountProfile(repository, userId) };
}
