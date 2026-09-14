export const releaseCandidateCheckNames = [
  "lint",
  "typecheck",
  "unit",
  "e2eDesktop",
  "build",
  "databaseRls",
  "contentPrivacy",
] as const;

export type ReleaseCandidateCheckName = (typeof releaseCandidateCheckNames)[number];
export type ReleaseCandidateCheckStatus = "passed" | "failed" | "blocked" | "not_run";

export type ReleaseCandidateCheck = Readonly<{
  status: ReleaseCandidateCheckStatus;
  detail?: string;
}>;

export type ReleaseCandidateGateInput = Readonly<{
  checks: Readonly<Partial<Record<ReleaseCandidateCheckName, ReleaseCandidateCheck>>>;
  openP0: number;
  openP1: number;
  productConfirmed: boolean;
  deferredVerification?: Readonly<{
    iphoneSafari: boolean;
    flutter: boolean;
  }>;
}>;

export type ReleaseCandidateBlockReason =
  | "required-check-not-passed"
  | "open-p0"
  | "open-p1"
  | "product-confirmation-required";

export type ReleaseCandidateGateResult = Readonly<{
  eligible: boolean;
  reasons: readonly Readonly<{
    code: ReleaseCandidateBlockReason;
    check?: ReleaseCandidateCheckName;
    detail: string;
  }>[];
  deferredVerification: Readonly<{
    iphoneSafari: boolean;
    flutter: boolean;
  }>;
}>;

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${field} must be a non-negative safe integer.`);
}

export function evaluateReleaseCandidateGate(input: ReleaseCandidateGateInput): ReleaseCandidateGateResult {
  requireNonNegativeInteger(input.openP0, "openP0");
  requireNonNegativeInteger(input.openP1, "openP1");
  const reasons: Array<{ code: ReleaseCandidateBlockReason; check?: ReleaseCandidateCheckName; detail: string }> = [];
  for (const checkName of releaseCandidateCheckNames) {
    const check = input.checks[checkName];
    if (check?.status !== "passed") {
      reasons.push({
        code: "required-check-not-passed",
        check: checkName,
        detail: check ? `${checkName} is ${check.status}.` : `${checkName} has no result.`,
      });
    }
  }
  if (input.openP0 > 0) reasons.push({ code: "open-p0", detail: `${input.openP0} P0 issue(s) remain open.` });
  if (input.openP1 > 0) reasons.push({ code: "open-p1", detail: `${input.openP1} P1 issue(s) remain open.` });
  if (!input.productConfirmed) reasons.push({ code: "product-confirmation-required", detail: "Product owner confirmation is required." });
  return {
    eligible: reasons.length === 0,
    reasons,
    deferredVerification: {
      iphoneSafari: input.deferredVerification?.iphoneSafari ?? true,
      flutter: input.deferredVerification?.flutter ?? true,
    },
  };
}
