import { createDrizzleScenarioLibraryRepository, getPublicScenarioDetail, getScenarioPracticeDetailForUser } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";
import type { NextRequest } from "next/server";

export async function GET(_request: Request, { params }: Readonly<{ params: Promise<{ scenarioId: string }> }>) {
  const { scenarioId } = await params;
  const key = decodeURIComponent(scenarioId);
  const publicScenario = getPublicScenarioDetail(key);
  if (publicScenario) {
    if (process.env.NODE_ENV === "production" && publicScenario.status !== "published") return scenarioError(_request, "SCENARIO_NOT_FOUND", "The scenario was not found.", 404);
    return scenarioData(publicScenario, { headers: { "cache-control": "private, max-age=60" } });
  }
  const user = (await verifyRequestUser(_request as NextRequest)) ?? (await getCurrentUser());
  if (!user) return scenarioError(_request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const scenario = await getScenarioPracticeDetailForUser(process.env.DATABASE_URL ? createDrizzleScenarioLibraryRepository(getDatabase()) : null, key, user.id).catch(() => null);
  return scenario ? scenarioData(scenario, { headers: { "cache-control": "private, no-store" } }) : scenarioError(_request, "SCENARIO_NOT_FOUND", "The scenario was not found.", 404);
}

export async function DELETE(request: NextRequest, { params }: Readonly<{ params: Promise<{ scenarioId: string }> }>) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const key = decodeURIComponent((await params).scenarioId);
  const match = /^personal\.([0-9a-f-]{36})$/iu.exec(key);
  if (!match) return scenarioError(request, "FORBIDDEN", "Only owned private scenarios can be removed here.", 403);
  if (!process.env.DATABASE_URL) return scenarioError(request, "PERSONAL_SCENARIO_UNAVAILABLE", "Private scenarios require account persistence.", 503, true);
  try {
    const archived = await createDrizzleScenarioLibraryRepository(getDatabase()).archivePersonalScenario(user.id, match[1]!);
    return archived ? scenarioData({ archived: true }, { headers: { "cache-control": "private, no-store" } }) : scenarioError(request, "SCENARIO_NOT_FOUND", "The scenario was not found.", 404);
  } catch { return scenarioError(request, "PERSONAL_SCENARIO_UNAVAILABLE", "The private scenario could not be removed.", 503, true); }
}
