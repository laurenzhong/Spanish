const UID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const UID_GROUP_LENGTH = 4;
const UID_PATTERN = /^SN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u;

export function isPublicUid(value: unknown): value is string {
  return typeof value === "string" && UID_PATTERN.test(value);
}

export function normalizePublicUid(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/gu, "");
}

export function generatePublicUid(randomBytes: Uint8Array = crypto.getRandomValues(new Uint8Array(8))): string {
  let groups = "";
  for (let index = 0; index < UID_GROUP_LENGTH * 2; index += 1) {
    groups += UID_ALPHABET[randomBytes[index % randomBytes.length] % UID_ALPHABET.length];
    if (index === UID_GROUP_LENGTH - 1) groups += "-";
  }
  return `SN-${groups}`;
}

export function publicUidColorIndex(publicUid: string, paletteSize: number): number {
  if (paletteSize < 1) throw new Error("paletteSize must be positive");
  let hash = 2166136261;
  for (const character of publicUid) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % paletteSize;
}
