export type AccountProfileDto = Readonly<{
  publicUid: string;
  displayName: string | null;
  targetLanguage: string;
  updatedAt: string;
  avatar: Readonly<{
    kind: "upload" | "preset" | "initials";
    presetId: string | null;
    url: string | null;
    initials: string;
    colorIndex: number;
  }>;
}>;

let pendingRequest: Promise<AccountProfileDto> | null = null;

export function loadAccountProfile(): Promise<AccountProfileDto> {
  if (pendingRequest) return pendingRequest;
  pendingRequest = fetch("/api/v1/me", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  }).then(async (response) => {
    if (!response.ok) throw new Error("ACCOUNT_PROFILE_UNAVAILABLE");
    const payload = await response.json() as { data?: AccountProfileDto };
    if (!payload.data) throw new Error("ACCOUNT_PROFILE_INVALID");
    return payload.data;
  }).finally(() => {
    pendingRequest = null;
  });
  return pendingRequest;
}
