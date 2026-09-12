import "server-only";

import { NextRequest } from "next/server";

import {
  buildProviderStatus,
  type ConfiguredProviderRegistration,
} from "@/src/modules/providers/provider-settings";
import { createDrizzleProviderHealthRepository } from "@/src/modules/providers/repositories/drizzle-provider-health-repository";
import { createDrizzleUserProviderPreferenceRepository } from "@/src/modules/providers/repositories/drizzle-user-provider-preference-repository";
import type { ProviderHealthRepository } from "@/src/modules/providers/repositories/provider-health-repository";
import type { UserProviderPreferenceRepository } from "@/src/modules/providers/repositories/user-provider-preference-repository";
import { createServerProviderRegistrations } from "@/src/modules/providers/routing/provider-registry";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

type Dependencies = Readonly<{
  registrations: readonly ConfiguredProviderRegistration[];
  preferences: UserProviderPreferenceRepository;
  health: ProviderHealthRepository;
}>;

function defaultDependencies(): Dependencies {
  const database = getDatabase();
  return {
    registrations: createServerProviderRegistrations(),
    preferences: createDrizzleUserProviderPreferenceRepository(database),
    health: createDrizzleProviderHealthRepository(database),
  };
}

export async function handleGetProviderStatus(
  request: NextRequest,
  dependencies?: Dependencies,
) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);

  try {
    if (!dependencies && !process.env.DATABASE_URL) {
      return scenarioData(buildProviderStatus({
        registrations: createServerProviderRegistrations(),
        preferences: [],
        observations: [],
      }), { headers: { "cache-control": "private, no-store" } });
    }
    const active = dependencies ?? defaultDependencies();
    const [preferences, observations] = await Promise.all([
      active.preferences.list(user.id),
      active.health.listObservationSummaries(),
    ]);
    return scenarioData(buildProviderStatus({
      registrations: active.registrations,
      preferences,
      observations,
    }), { headers: { "cache-control": "private, no-store" } });
  } catch {
    return scenarioError(request, "PROVIDER_UNAVAILABLE", "Provider status is temporarily unavailable.", 503, true);
  }
}

export function GET(request: NextRequest) {
  return handleGetProviderStatus(request);
}
