import type { AccountRepository } from "../repositories";
import type { AvatarStorage } from "../storage";
import { getAccountProfile } from "./get-account-profile";

export async function deleteAvatar(repository: AccountRepository, storage: AvatarStorage, userId: string) {
  const current = await repository.get(userId);
  if (!current) return { kind: "not-found" as const };
  const updated = await repository.update(userId, { avatarKind: "initials", avatarPresetId: null, avatarPath: null, expectedUpdatedAt: current.updatedAt });
  if (updated === "conflict") return { kind: "conflict" as const };
  if (current.avatarPath) await storage.remove(current.avatarPath).catch(() => undefined);
  return { kind: "ok" as const, profile: await getAccountProfile(repository, userId) };
}
