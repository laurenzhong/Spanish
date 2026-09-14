export type ProcessingBudgetPolicy = Readonly<{
  dailyCostLimitMicros: number;
  monthlyCostLimitMicros: number;
  maxCandidateBytes: number;
  maxDurationSeconds: number;
}>;

export type ProcessingBudgetUsage = Readonly<{
  dailyCostMicros: number;
  monthlyCostMicros: number;
}>;

export type ProcessingBudgetRequest = Readonly<{
  estimatedCostMicros: number;
  assetBytes: number;
  durationSeconds: number;
}>;

export type ProcessingBudgetDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: "daily-cost" | "monthly-cost" | "asset-size" | "duration" }>;

function requireNonNegativeInteger(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer.`);
  }
}

export function evaluateProcessingBudget(
  policy: ProcessingBudgetPolicy,
  usage: ProcessingBudgetUsage,
  request: ProcessingBudgetRequest,
): ProcessingBudgetDecision {
  for (const [field, value] of Object.entries({ ...policy, ...usage, ...request })) {
    requireNonNegativeInteger(value, field);
  }
  if (usage.dailyCostMicros + request.estimatedCostMicros > policy.dailyCostLimitMicros) {
    return { allowed: false, reason: "daily-cost" };
  }
  if (usage.monthlyCostMicros + request.estimatedCostMicros > policy.monthlyCostLimitMicros) {
    return { allowed: false, reason: "monthly-cost" };
  }
  if (request.assetBytes > policy.maxCandidateBytes) {
    return { allowed: false, reason: "asset-size" };
  }
  if (request.durationSeconds > policy.maxDurationSeconds) {
    return { allowed: false, reason: "duration" };
  }
  return { allowed: true };
}
