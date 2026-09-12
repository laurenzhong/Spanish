import {
  deriveProviderHealth,
  type ProviderHealthObservation,
  type ProviderHealthStatus,
} from "./routing/provider-health";
import {
  ProviderRegistry,
  ProviderRegistryError,
  providerCapabilities,
  type ProviderCapability,
  type ProviderRegistration,
} from "./routing/provider-registry";
import type { ProviderObservationSummary } from "./repositories/provider-health-repository";
import type {
  UserProviderPreference,
  UserProviderPreferenceRepository,
} from "./repositories/user-provider-preference-repository";

export type ConfiguredProviderRegistration = Omit<ProviderRegistration, "health">;

export type ProviderStatusItem = Readonly<{
  key: string;
  label: string;
  configured: boolean;
  status: ProviderHealthStatus;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}>;

export type ProviderCapabilityStatus = Readonly<{
  capability: ProviderCapability;
  selectedProviderKey: string | null;
  selectedProviderAvailable: boolean;
  effectiveProviderKey: string | null;
  canAutoSwitch: boolean;
  providers: readonly ProviderStatusItem[];
}>;

export type ProviderStatus = Readonly<{
  capabilities: readonly ProviderCapabilityStatus[];
}>;

export function buildProviderStatus(input: Readonly<{
  registrations: readonly ConfiguredProviderRegistration[];
  preferences: readonly UserProviderPreference[];
  observations: readonly ProviderObservationSummary[];
  now?: Date;
}>): ProviderStatus {
  const preferenceMap = new Map(input.preferences.map((item) => [item.capability, item.providerKey]));
  return {
    capabilities: providerCapabilities.map((capability) => {
      const providers = input.registrations
        .filter((registration) => registration.capabilities.includes(capability))
        .map((registration) => statusForRegistration(registration, capability, input.observations, input.now));
      const registry = new ProviderRegistry(providers.map((provider) => ({
        key: provider.key,
        label: provider.label,
        configured: provider.configured,
        capabilities: [capability],
        health: provider.status,
      })));
      const selectedProviderKey = preferenceMap.get(capability) ?? null;
      const selectedProviderAvailable = selectedProviderKey
        ? registry.supports(capability, selectedProviderKey)
        : true;
      let effectiveProviderKey: string | null = null;
      try {
        effectiveProviderKey = registry.select(
          capability,
          selectedProviderAvailable ? selectedProviderKey : null,
        ).key;
      } catch (error) {
        if (!(error instanceof ProviderRegistryError) || error.code !== "PROVIDER_NOT_CONFIGURED") {
          throw error;
        }
      }
      return {
        capability,
        selectedProviderKey,
        selectedProviderAvailable,
        effectiveProviderKey,
        canAutoSwitch: providers.filter((provider) => provider.configured).length > 1,
        providers,
      };
    }),
  };
}

export async function updateProviderPreference(input: Readonly<{
  repository: UserProviderPreferenceRepository;
  registrations: readonly ConfiguredProviderRegistration[];
  userId: string;
  capability: ProviderCapability;
  providerKey: string | null;
}>): Promise<UserProviderPreference | null> {
  if (input.providerKey === null) {
    await input.repository.clear(input.userId, input.capability);
    return null;
  }
  const registration = input.registrations.find((candidate) =>
    candidate.key === input.providerKey &&
    candidate.configured &&
    candidate.capabilities.includes(input.capability),
  );
  if (!registration) {
    throw new ProviderRegistryError(
      "PROVIDER_PREFERENCE_INVALID",
      "The selected provider is unavailable for this capability.",
    );
  }
  return input.repository.set(input.userId, input.capability, input.providerKey);
}

function statusForRegistration(
  registration: ConfiguredProviderRegistration,
  capability: ProviderCapability,
  observations: readonly ProviderObservationSummary[],
  now?: Date,
): ProviderStatusItem {
  const summary = observations.find((candidate) =>
    candidate.capability === capability && candidate.providerKey === registration.key,
  );
  const healthObservations: ProviderHealthObservation[] = [
    ...(summary?.lastSuccessAt ? [{ status: "succeeded" as const, completedAt: summary.lastSuccessAt }] : []),
    ...(summary?.lastFailureAt ? [{ status: "failed" as const, completedAt: summary.lastFailureAt }] : []),
  ];
  return {
    key: registration.key,
    label: registration.label,
    configured: registration.configured,
    status: deriveProviderHealth({ configured: registration.configured, observations: healthObservations, now }),
    lastSuccessAt: summary?.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: summary?.lastFailureAt?.toISOString() ?? null,
  };
}

export type { ProviderObservationSummary, UserProviderPreference, UserProviderPreferenceRepository };
