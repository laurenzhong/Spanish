import { NextRequest } from "next/server";

import { createDrizzleScenarioPracticeRepository, listDueScenarioRepetitions } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

export async function GET(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  if (!process.env.DATABASE_URL) return scenarioData([], { headers: { "cache-control": "private, no-store" } });
  try {
    return scenarioData(await listDueScenarioRepetitions(createDrizzleScenarioPracticeRepository(getDatabase()), user.id), { headers: { "cache-control": "private, no-store" } });
  } catch {
    return scenarioError(request, "SCENARIO_SESSION_UNAVAILABLE", "Due repetitions are temporarily unavailable.", 503, true);
  }
}
