import { validateAccountProfilePatch, type AccountProfilePatch } from "../domain/account-profile";
import { getAccountProfile } from "./get-account-profile";
import type { AccountRepository } from "../repositories";

export async function updateAccountProfile(repository: AccountRepository, userId: string, input: unknown, expectedUpdatedAt?: Date) {
  const patch: AccountProfilePatch = validateAccountProfilePatch(input);
  const result = await repository.update(userId, {
    ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
    ...(patch.avatarKind === undefined ? {} : { avatarKind: patch.avatarKind }),
    ...(patch.avatarPresetId === undefined ? {} : { avatarPresetId: patch.avatarPresetId }),
    ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
  });
  if (result === "conflict") return { kind: "conflict" as const };
  if (!result) return { kind: "not-found" as const };
  return { kind: "ok" as const, profile: await getAccountProfile(repository, userId) };
}
