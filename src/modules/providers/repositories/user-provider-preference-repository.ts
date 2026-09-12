import type { ProviderCapability } from "../routing/provider-registry";

export type UserProviderPreference = Readonly<{
  capability: ProviderCapability;
  providerKey: string;
}>;

export interface UserProviderPreferenceRepository {
  list(userId: string): Promise<readonly UserProviderPreference[]>;
  set(
    userId: string,
    capability: ProviderCapability,
    providerKey: string,
  ): Promise<UserProviderPreference>;
  clear(userId: string, capability: ProviderCapability): Promise<void>;
}
