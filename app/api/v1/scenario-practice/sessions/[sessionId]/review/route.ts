import { NextRequest } from "next/server";

import { createDrizzleScenarioPracticeRepository, getScenarioSessionReview } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

export async function GET(request: NextRequest, { params }: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser()); if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  if (!process.env.DATABASE_URL) return scenarioData({ persistence: "device", turns: [], reviews: [] });
  const { sessionId } = await params;
  try { return scenarioData({ ...(await getScenarioSessionReview(createDrizzleScenarioPracticeRepository(getDatabase()), user.id, sessionId)), persistence: "account" }, { headers: { "cache-control": "no-store" } }); }
  catch { return scenarioError(request, "SCENARIO_SESSION_NOT_FOUND", "The scenario review was not found.", 404); }
}
