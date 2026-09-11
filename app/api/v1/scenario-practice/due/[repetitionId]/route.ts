import { NextRequest } from "next/server";
import { z } from "zod";

import { completeScenarioRepetition, createDrizzleScenarioPracticeRepository } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

const completionSchema = z.strictObject({
  completionKey: z.string().trim().min(1).max(128),
  result: z.enum(["contextual-success", "needs-work", "technical-failure"]),
});

export async function GET(request: NextRequest, { params }: Readonly<{ params: Promise<{ repetitionId: string }> }>) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  if (!process.env.DATABASE_URL) return scenarioError(request, "RESOURCE_NOT_FOUND", "The repetition was not found.", 404);
  const { repetitionId } = await params;
  const item = await createDrizzleScenarioPracticeRepository(getDatabase()).getRepetitionItem(user.id, repetitionId).catch(() => null);
  return item ? scenarioData(item, { headers: { "cache-control": "private, no-store" } }) : scenarioError(request, "RESOURCE_NOT_FOUND", "The repetition was not found.", 404);
}

export async function POST(request: NextRequest, { params }: Readonly<{ params: Promise<{ repetitionId: string }> }>) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const parsed = completionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return scenarioError(request, "VALIDATION_FAILED", "The repetition completion request is invalid.", 400);
  if (!process.env.DATABASE_URL) return scenarioData({ status: "device-only" }, { status: 202 });
  const { repetitionId } = await params;
  try {
    return scenarioData(await completeScenarioRepetition(createDrizzleScenarioPracticeRepository(getDatabase()), { userId: user.id, repetitionId, ...parsed.data }));
  } catch (error) {
    if (error instanceof Error && error.message === "SCENARIO_REPETITION_NOT_FOUND") return scenarioError(request, "RESOURCE_NOT_FOUND", "The repetition was not found.", 404);
    return scenarioError(request, "SCENARIO_TURN_CONFLICT", "The repetition changed before completion.", 409);
  }
}
