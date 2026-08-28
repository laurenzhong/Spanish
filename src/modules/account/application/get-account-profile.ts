import { assertAccountProfile, type AccountProfile } from "../domain/account-profile";
import type { AccountRepository } from "../repositories";

export async function getAccountProfile(repository: AccountRepository, userId: string): Promise<AccountProfile | null> {
  const record = await repository.get(userId);
  if (!record) return null;
  return assertAccountProfile({
    publicUid: record.publicUid,
    displayName: record.displayName,
    nativeLanguage: record.nativeLanguage,
    interfaceLanguage: record.interfaceLanguage,
    targetLanguage: record.targetLanguage,
    avatar: {
      kind: record.avatarKind,
      presetId: record.avatarPresetId,
      path: record.avatarPath,
    },
    updatedAt: record.updatedAt,
  });
}
