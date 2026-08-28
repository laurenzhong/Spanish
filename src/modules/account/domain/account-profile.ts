import { isPublicUid } from "./public-uid";
import { AVATAR_KINDS, AVATAR_PRESET_IDS, type AvatarKind, type AvatarPresetId } from "./avatar";

export type AccountProfile = Readonly<{
  publicUid: string;
  displayName: string | null;
  nativeLanguage: string;
  interfaceLanguage: string;
  targetLanguage: string;
  avatar: Readonly<{
    kind: AvatarKind;
    presetId: AvatarPresetId | null;
    path: string | null;
  }>;
  updatedAt: Date;
}>;

export type AccountProfilePatch = Readonly<{
  displayName?: string | null;
  avatarKind?: AvatarKind;
  avatarPresetId?: AvatarPresetId | null;
}>;

export function validateAccountProfilePatch(input: unknown): AccountProfilePatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid-patch");
  const value = input as Record<string, unknown>;
  const allowed = new Set(["displayName", "avatarKind", "avatarPresetId"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("invalid-patch");
  if (value.displayName !== undefined && value.displayName !== null && (typeof value.displayName !== "string" || value.displayName.trim().length > 80)) throw new Error("invalid-display-name");
  if (value.avatarKind !== undefined && !AVATAR_KINDS.includes(value.avatarKind as AvatarKind)) throw new Error("invalid-avatar-kind");
  if (value.avatarPresetId !== undefined && value.avatarPresetId !== null && !AVATAR_PRESET_IDS.includes(value.avatarPresetId as AvatarPresetId)) throw new Error("invalid-avatar-preset");
  if (value.avatarKind === "preset" && !value.avatarPresetId) throw new Error("missing-avatar-preset");
  return {
    ...(value.displayName === undefined ? {} : { displayName: value.displayName === null ? null : value.displayName.trim() }),
    ...(value.avatarKind === undefined ? {} : { avatarKind: value.avatarKind as AvatarKind }),
    ...(value.avatarPresetId === undefined ? {} : { avatarPresetId: value.avatarPresetId as AvatarPresetId | null }),
  };
}

export function assertAccountProfile(profile: AccountProfile): AccountProfile {
  if (!isPublicUid(profile.publicUid)) throw new Error("invalid-public-uid");
  return profile;
}
