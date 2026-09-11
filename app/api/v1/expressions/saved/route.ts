import { NextRequest } from "next/server";

import { SavedExpressionConflictError, SavedExpressionSourceError, createDrizzleScenarioLibraryRepository, listSavedExpressions, saveExpression, type ScenarioLibraryRepository } from "@/src/modules/scenario-practice";
import { saveExpressionRequestSchema } from "@/src/modules/scenario-practice/schemas";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

function defaultRepository() { return createDrizzleScenarioLibraryRepository(getDatabase()); }

export async function handleSavedExpressions(request: NextRequest, repository?: ScenarioLibraryRepository) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  if (!process.env.DATABASE_URL && !repository) return scenarioError(request, "SAVED_EXPRESSION_UNAVAILABLE", "Saved expressions require account persistence.", 503, true);
  const activeRepository = repository ?? defaultRepository();
  try {
    if (request.method === "GET") return scenarioData({ expressions: await listSavedExpressions(activeRepository, user.id) }, { headers: { "cache-control": "private, no-store" } });
    const parsed = saveExpressionRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return scenarioError(request, "VALIDATION_FAILED", "The saved-expression request is invalid.", 400);
    const saved = await saveExpression(activeRepository, { userId: user.id, clientSaveId: parsed.data.clientSaveId, source: parsed.data.source });
    return scenarioData(saved, { status: 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SavedExpressionSourceError) return scenarioError(request, "SAVED_EXPRESSION_SOURCE_NOT_FOUND", error.message, 404);
    if (error instanceof SavedExpressionConflictError) return scenarioError(request, "CONFLICT", error.message, 409);
    return scenarioError(request, "SAVED_EXPRESSION_UNAVAILABLE", "Saved expressions are temporarily unavailable.", 503, true);
  }
}

export function GET(request: NextRequest) { return handleSavedExpressions(request); }
export function POST(request: NextRequest) { return handleSavedExpressions(request); }
