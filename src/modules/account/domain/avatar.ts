export const AVATAR_KINDS = ["upload", "preset", "initials"] as const;
export type AvatarKind = (typeof AVATAR_KINDS)[number];

export const AVATAR_PRESET_IDS = [
  "sunlit-window",
  "terracotta-scarf",
  "green-notebook",
  "paper-collage",
  "evening-studio",
  "quiet-cafe",
] as const;
export type AvatarPresetId = (typeof AVATAR_PRESET_IDS)[number];

export type AvatarReference = Readonly<{
  kind: AvatarKind;
  presetId: AvatarPresetId | null;
  url: string | null;
  initials: string;
  colorIndex: number;
}>;

export function initialsForDisplayName(displayName: string | null | undefined): string {
  const normalized = displayName?.trim() ?? "";
  if (!normalized) return "你";
  return Array.from(normalized)[0] ?? "你";
}
