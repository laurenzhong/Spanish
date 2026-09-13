export const sourceRightsStatuses = ["unknown", "verified", "restricted", "revoked"] as const;
export type SourceRightsStatus = (typeof sourceRightsStatuses)[number];

export type SourceOperation =
  | "read-metadata"
  | "acquire-large-asset"
  | "process"
  | "publish";

export type SourcePolicyDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: "source-disabled" | "rights-required" | "rights-restricted" | "rights-revoked" }>;

export function evaluateSourcePolicy(input: Readonly<{
  enabled: boolean;
  rightsStatus: SourceRightsStatus;
  operation: SourceOperation;
}>): SourcePolicyDecision {
  if (!input.enabled) return { allowed: false, reason: "source-disabled" };
  if (input.operation === "read-metadata") return { allowed: true };
  if (input.rightsStatus === "verified") return { allowed: true };
  if (input.rightsStatus === "unknown") return { allowed: false, reason: "rights-required" };
  if (input.rightsStatus === "restricted") return { allowed: false, reason: "rights-restricted" };
  return { allowed: false, reason: "rights-revoked" };
}
