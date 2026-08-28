import type { AvatarKind, AvatarPresetId } from "../domain/avatar";

export type AccountProfileRecord = Readonly<{
  userId: string;
  publicUid: string;
  displayName: string | null;
  nativeLanguage: string;
  interfaceLanguage: string;
  targetLanguage: string;
  avatarKind: AvatarKind;
  avatarPresetId: AvatarPresetId | null;
  avatarPath: string | null;
  updatedAt: Date;
}>;

export type AccountProfileUpdate = Readonly<{
  displayName?: string | null;
  avatarKind?: AvatarKind;
  avatarPresetId?: AvatarPresetId | null;
  avatarPath?: string | null;
  expectedUpdatedAt?: Date;
}>;

export interface AccountRepository {
  get(userId: string): Promise<AccountProfileRecord | null>;
  update(userId: string, update: AccountProfileUpdate): Promise<AccountProfileRecord | "conflict" | null>;
}
