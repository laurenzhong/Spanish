import { NextRequest } from "next/server";

import { createDrizzleScenarioLibraryRepository, deleteSavedExpression } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

export async function DELETE(request: NextRequest, context: Readonly<{ params: Promise<{ savedExpressionId: string }> }>) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  if (!process.env.DATABASE_URL) return scenarioError(request, "SAVED_EXPRESSION_UNAVAILABLE", "Saved expressions require account persistence.", 503, true);
  const { savedExpressionId } = await context.params;
  if (!/^[0-9a-f-]{36}$/iu.test(savedExpressionId)) return scenarioError(request, "VALIDATION_FAILED", "The saved expression id is invalid.", 400);
  try {
    const deleted = await deleteSavedExpression(createDrizzleScenarioLibraryRepository(getDatabase()), user.id, savedExpressionId);
    return deleted ? scenarioData({ archived: true }, { headers: { "cache-control": "private, no-store" } }) : scenarioError(request, "SAVED_EXPRESSION_NOT_FOUND", "The saved expression was not found.", 404);
  } catch { return scenarioError(request, "SAVED_EXPRESSION_UNAVAILABLE", "Saved expressions are temporarily unavailable.", 503, true); }
}
