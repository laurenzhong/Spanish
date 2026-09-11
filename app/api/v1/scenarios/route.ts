import { NextRequest } from "next/server";

import { createDrizzleScenarioLibraryRepository } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

export async function GET(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  if (!process.env.DATABASE_URL) return scenarioData({ scenarios: [], generationSources: { savedExpressions: [], readingHighlights: [], recentErrors: [] }, generationAvailable: false }, { headers: { "cache-control": "private, no-store" } });
  try {
    const repository = createDrizzleScenarioLibraryRepository(getDatabase());
    const [candidates, generationSources] = await Promise.all([repository.listPersonalSuggestionCandidates(user.id), repository.listGenerationSources(user.id)]);
    return scenarioData({ scenarios: candidates.map((item) => ({ ...item, route: `/explore/scenarios/personal.${item.id}` })), generationSources, generationAvailable: Boolean(process.env.MINIMAX_API_KEY) || (process.env.NODE_ENV !== "production" && process.env.AUTH_E2E_ENABLED === "1") }, { headers: { "cache-control": "private, no-store" } });
  } catch { return scenarioError(request, "PERSONAL_SCENARIO_UNAVAILABLE", "Private scenarios are temporarily unavailable.", 503, true); }
}
