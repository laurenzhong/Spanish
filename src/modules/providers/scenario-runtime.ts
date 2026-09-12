import "server-only";

import { buildProviderStatus } from "./provider-settings";
import { createDrizzleProviderHealthRepository } from "./repositories/drizzle-provider-health-repository";
import { createDrizzleUserProviderPreferenceRepository } from "./repositories/drizzle-user-provider-preference-repository";
import { ProviderRegistry } from "./routing/provider-registry";
import type { ProviderCapability } from "./routing/provider-registry";
import { createMiniMaxScenarioGenerationProvider, createOpenAIScenarioGenerationProvider } from "./scenario-generation/server";
import type { ScenarioGenerationProvider } from "./scenario-generation";
import { createMiniMaxScenarioRoleplayProvider, createOpenAIScenarioRoleplayProvider } from "./scenario-roleplay/server";
import type { ScenarioRoleplayProvider } from "./scenario-roleplay";
import { createMiniMaxScenarioEvaluationProvider, createOpenAIScenarioEvaluationProvider } from "./scenario-evaluation/server";
import type { ScenarioEvaluationProvider } from "./scenario-evaluation";
import { createServerProviderRegistrations } from "./routing/provider-registry";
import { getDatabase } from "@/src/shared/db/client";

export async function resolveScenarioProviderOrder(
  userId: string,
  capability: Extract<ProviderCapability, "scenario-generation" | "scenario-roleplay" | "scenario-evaluation">,
): Promise<readonly string[]> {
  const registrations = createServerProviderRegistrations();
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  const [preferences, observations] = databaseConfigured
    ? await Promise.all([
        createDrizzleUserProviderPreferenceRepository(getDatabase()).list(userId),
        createDrizzleProviderHealthRepository(getDatabase()).listObservationSummaries(),
      ])
    : [[], []] as const;
  const status = buildProviderStatus({ registrations, preferences, observations });
  const capabilityStatus = status.capabilities.find((entry) => entry.capability === capability);
  if (!capabilityStatus) return [];
  const registry = new ProviderRegistry(capabilityStatus.providers.map((provider) => ({
    key: provider.key,
    label: provider.label,
    configured: provider.configured,
    capabilities: [capability],
    health: provider.status,
  })));
  const preferred = capabilityStatus.selectedProviderAvailable
    ? capabilityStatus.selectedProviderKey
    : null;
  const primary = registry.select(capability, preferred);
  const fallback = registry.selectFallback(capability, [primary.key]);
  return fallback ? [primary.key, fallback.key] : [primary.key];
}

export async function createScenarioGenerationProviders(userId: string): Promise<readonly ScenarioGenerationProvider[]> {
  return (await resolveScenarioProviderOrder(userId, "scenario-generation")).map((key) => {
    if (key === "openai") return createOpenAIScenarioGenerationProvider();
    return createMiniMaxScenarioGenerationProvider();
  });
}

export async function createScenarioRoleplayProviders(userId: string): Promise<readonly ScenarioRoleplayProvider[]> {
  return (await resolveScenarioProviderOrder(userId, "scenario-roleplay")).map((key) => {
    if (key === "openai") return createOpenAIScenarioRoleplayProvider();
    return createMiniMaxScenarioRoleplayProvider();
  });
}

export async function createScenarioEvaluationProviders(userId: string): Promise<readonly ScenarioEvaluationProvider[]> {
  return (await resolveScenarioProviderOrder(userId, "scenario-evaluation")).map((key) => {
    if (key === "openai") return createOpenAIScenarioEvaluationProvider();
    return createMiniMaxScenarioEvaluationProvider();
  });
}
