import { NextRequest } from "next/server";

import { createDrizzleScenarioPracticeRepository } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

export async function GET(request: NextRequest, { params }: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  if (!process.env.DATABASE_URL) return scenarioError(request, "SCENARIO_SESSION_NOT_FOUND", "The account session was not found.", 404);
  const { sessionId } = await params;
  try {
    const repository = createDrizzleScenarioPracticeRepository(getDatabase());
    const session = await repository.getSession(user.id, sessionId);
    if (!session) return scenarioError(request, "SCENARIO_SESSION_NOT_FOUND", "The account session was not found.", 404);
    const turns = await repository.listTurns(user.id, sessionId);
    return scenarioData({ session, turns }, { headers: { "cache-control": "no-store" } });
  } catch { return scenarioError(request, "SCENARIO_SESSION_UNAVAILABLE", "The scenario session is temporarily unavailable.", 503, true); }
}
