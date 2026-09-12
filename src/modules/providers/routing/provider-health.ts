export const providerHealthStatuses = [
  "configured",
  "healthy",
  "degraded",
  "unavailable",
] as const;

export type ProviderHealthStatus = (typeof providerHealthStatuses)[number];

export type ProviderHealthObservation = Readonly<{
  status: "started" | "succeeded" | "failed" | "cancelled";
  completedAt: Date;
}>;

const defaultFreshnessMs = 24 * 60 * 60 * 1_000;

export function deriveProviderHealth(input: Readonly<{
  configured: boolean;
  observations: readonly ProviderHealthObservation[];
  now?: Date;
  freshnessMs?: number;
}>): ProviderHealthStatus {
  if (!input.configured) return "unavailable";
  const now = input.now ?? new Date();
  const freshnessMs = input.freshnessMs ?? defaultFreshnessMs;
  const latestTerminal = [...input.observations]
    .filter((observation) =>
      (observation.status === "succeeded" || observation.status === "failed") &&
      now.getTime() - observation.completedAt.getTime() <= freshnessMs &&
      observation.completedAt.getTime() <= now.getTime(),
    )
    .sort((left, right) => right.completedAt.getTime() - left.completedAt.getTime())[0];

  if (!latestTerminal) return "configured";
  return latestTerminal.status === "succeeded" ? "healthy" : "degraded";
}
