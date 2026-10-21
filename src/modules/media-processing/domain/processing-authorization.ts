export type MediaProcessingOperation = "acquire-audio" | "asr" | "translate";
export type MediaProcessingAudience = "owner-private" | "shared-learning";

export type MediaProcessingAuthorization = Readonly<{
  version: 1;
  allowedOperations: readonly MediaProcessingOperation[];
  audience: MediaProcessingAudience;
  thirdPartyProcessing: boolean;
  evidenceUrl: string;
  expiresAt: string | null;
}>;

/** Receives a validated grant; a license label or verified flag is never a grant. */
export function isMediaProcessingAuthorized(input: Readonly<{
  sourceEnabled: boolean;
  rightsStatus: string;
  authorization: MediaProcessingAuthorization | null;
  operations: readonly MediaProcessingOperation[];
  audience: MediaProcessingAudience;
  now: Date;
}>): boolean {
  if (!input.sourceEnabled || input.rightsStatus !== "verified") return false;
  if (input.operations.length === 0) return true;
  const grant = input.authorization;
  if (!grant || grant.audience !== input.audience || !Number.isFinite(input.now.getTime())) return false;
  if (grant.expiresAt !== null && !(Date.parse(grant.expiresAt) > input.now.getTime())) return false;
  if (input.operations.some((operation) => !grant.allowedOperations.includes(operation))) return false;
  return !input.operations.some((operation) => operation === "asr" || operation === "translate") || grant.thirdPartyProcessing;
}
