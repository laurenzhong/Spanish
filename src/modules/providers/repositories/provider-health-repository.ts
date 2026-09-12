import type { ProviderCapability } from "../routing/provider-registry";

export type ProviderObservationSummary = Readonly<{
  capability: ProviderCapability;
  providerKey: string;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
}>;

export interface ProviderHealthRepository {
  listObservationSummaries(): Promise<readonly ProviderObservationSummary[]>;
}
