import { NextRequest } from "next/server";

import { FakeScenarioGenerationProvider, ScenarioProviderError, type ScenarioGenerationProvider } from "@/src/modules/providers/scenario-generation";
import { PersonalScenarioConflictError, PersonalScenarioSourceError, createDrizzleScenarioLibraryRepository, generatePersonalScenario, type ScenarioLibraryRepository } from "@/src/modules/scenario-practice";
import { createScenarioGenerationProviders } from "@/src/modules/providers/scenario-runtime";
import { observeScenarioGenerationProvider } from "@/src/modules/providers/observed-scenario-providers";
import { createDrizzleProviderCallRepository } from "@/src/modules/providers/repositories/drizzle-provider-call-repository";
import { generatePersonalScenarioRequestSchema } from "@/src/modules/scenario-practice/schemas";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

type Dependencies = Readonly<{ repository: ScenarioLibraryRepository; provider: ScenarioGenerationProvider | readonly ScenarioGenerationProvider[] }>;

export async function handleGeneratePersonalScenario(request: NextRequest, dependencies?: Dependencies) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._-]{8,128}$/u.test(idempotencyKey)) return scenarioError(request, "VALIDATION_FAILED", "A valid Idempotency-Key is required.", 400);
  const parsed = generatePersonalScenarioRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return scenarioError(request, "VALIDATION_FAILED", "The private scenario request is invalid.", 400);
  if (!process.env.DATABASE_URL && !dependencies) return scenarioError(request, "PERSONAL_SCENARIO_UNAVAILABLE", "Private scenarios require account persistence.", 503, true);
  try {
    let active = dependencies;
    if (!active) {
      const database = getDatabase();
      const provider = process.env.NODE_ENV !== "production" && process.env.AUTH_E2E_ENABLED === "1"
        ? new FakeScenarioGenerationProvider()
        : (await createScenarioGenerationProviders(user.id)).map((candidate) =>
            observeScenarioGenerationProvider(candidate, createDrizzleProviderCallRepository(database), user.id));
      active = { repository: createDrizzleScenarioLibraryRepository(database), provider };
    }
    const record = await generatePersonalScenario(active.repository, active.provider, { userId: user.id, idempotencyKey, ...parsed.data }, { signal: request.signal });
    return scenarioData({ id: record.id, title: record.detail.title, cefr: record.detail.cefr, sourceType: record.sourceType, route: `/explore/scenarios/personal.${record.id}`, createdAt: record.createdAt }, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PersonalScenarioSourceError) return scenarioError(request, "PERSONAL_SCENARIO_SOURCE_NOT_FOUND", error.message, 404);
    if (error instanceof PersonalScenarioConflictError) return scenarioError(request, "CONFLICT", error.message, 409);
    if (error instanceof ScenarioProviderError) {
      if (error.code === "PROVIDER_NOT_CONFIGURED" || error.code === "provider-auth-failed") return scenarioError(request, "PROVIDER_NOT_CONFIGURED", error.message, 503);
      if (error.code === "provider-timeout") return scenarioError(request, "PROVIDER_TIMEOUT", error.message, 504, true);
      return scenarioError(request, "PROVIDER_UNAVAILABLE", error.message, 503, error.retryable);
    }
    return scenarioError(request, "PERSONAL_SCENARIO_UNAVAILABLE", "The private scenario could not be generated.", 503, true);
  }
}

export function POST(request: NextRequest) { return handleGeneratePersonalScenario(request); }
