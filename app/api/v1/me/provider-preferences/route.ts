import "server-only";

import { NextRequest } from "next/server";
import { z } from "zod";

import {
  updateProviderPreference,
  type ConfiguredProviderRegistration,
} from "@/src/modules/providers/provider-settings";
import { createDrizzleUserProviderPreferenceRepository } from "@/src/modules/providers/repositories/drizzle-user-provider-preference-repository";
import type { UserProviderPreferenceRepository } from "@/src/modules/providers/repositories/user-provider-preference-repository";
import {
  createServerProviderRegistrations,
  providerCapabilities,
  ProviderRegistryError,
} from "@/src/modules/providers/routing/provider-registry";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

type ReadDependencies = Readonly<{ repository: UserProviderPreferenceRepository }>;
type WriteDependencies = Readonly<{
  repository: UserProviderPreferenceRepository;
  registrations: readonly ConfiguredProviderRegistration[];
}>;

const patchSchema = z.strictObject({
  capability: z.enum(providerCapabilities),
  providerKey: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/u).nullable(),
});

function repository() {
  return createDrizzleUserProviderPreferenceRepository(getDatabase());
}

export async function handleGetProviderPreferences(
  request: NextRequest,
  dependencies?: ReadDependencies,
) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  if (!dependencies && !process.env.DATABASE_URL) {
    return scenarioData({ preferences: [] }, { headers: { "cache-control": "private, no-store" } });
  }
  try {
    const preferences = await (dependencies?.repository ?? repository()).list(user.id);
    return scenarioData({ preferences }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return scenarioError(request, "PROVIDER_UNAVAILABLE", "Provider preferences are temporarily unavailable.", 503, true);
  }
}

export async function handlePatchProviderPreference(
  request: NextRequest,
  dependencies?: WriteDependencies,
) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return scenarioError(request, "VALIDATION_FAILED", "The provider preference is invalid.", 400);
  if (!dependencies && !process.env.DATABASE_URL) {
    return scenarioError(request, "PROVIDER_UNAVAILABLE", "Provider preferences require account persistence.", 503, true);
  }
  try {
    const active = dependencies ?? {
      repository: repository(),
      registrations: createServerProviderRegistrations(),
    };
    const preference = await updateProviderPreference({
      ...parsed.data,
      repository: active.repository,
      registrations: active.registrations,
      userId: user.id,
    });
    return scenarioData({ preference }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ProviderRegistryError && error.code === "PROVIDER_PREFERENCE_INVALID") {
      return scenarioError(request, "VALIDATION_FAILED", error.message, 400);
    }
    return scenarioError(request, "PROVIDER_UNAVAILABLE", "Provider preferences are temporarily unavailable.", 503, true);
  }
}

export function GET(request: NextRequest) {
  return handleGetProviderPreferences(request);
}

export function PATCH(request: NextRequest) {
  return handlePatchProviderPreference(request);
}
