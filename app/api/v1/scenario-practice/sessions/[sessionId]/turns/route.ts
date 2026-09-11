import { NextRequest } from "next/server";
import { z } from "zod";

import { createDrizzleScenarioPracticeRepository } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

const requestSchema = z.strictObject({ id: z.string().uuid(), clientAttemptId: z.string().min(1).max(128), turnIndex: z.number().int().nonnegative(), modality: z.enum(["speech", "typing"]), text: z.string().trim().min(1).max(2_000), attemptId: z.string().min(1).max(128), generationId: z.string().min(1).max(128) });

async function auth(request: NextRequest) { return (await verifyRequestUser(request)) ?? (await getCurrentUser()); }

export async function GET(request: NextRequest, { params }: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const user = await auth(request); if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  if (!process.env.DATABASE_URL) return scenarioData({ turns: [], persistence: "device" });
  const { sessionId } = await params;
  try { return scenarioData({ turns: await createDrizzleScenarioPracticeRepository(getDatabase()).listTurns(user.id, sessionId), persistence: "account" }); }
  catch { return scenarioError(request, "SCENARIO_SESSION_UNAVAILABLE", "The scenario turns are temporarily unavailable.", 503, true); }
}

export async function POST(request: NextRequest, { params }: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const user = await auth(request); if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return scenarioError(request, "VALIDATION_FAILED", "The completed turn is invalid.", 400);
  if (!process.env.DATABASE_URL) return scenarioData({ persistence: "device" }, { status: 202 });
  const { sessionId } = await params;
  try {
    const turn = await createDrizzleScenarioPracticeRepository(getDatabase()).appendCompletedUserTurn({ ...parsed.data, userId: user.id, sessionId, speaker: "user" });
    return scenarioData({ turn, persistence: "account" }, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "SCENARIO_TURN_CONFLICT";
    const safeCode = code === "SCENARIO_SESSION_NOT_FOUND" ? "SCENARIO_SESSION_NOT_FOUND" : "SCENARIO_TURN_CONFLICT";
    return scenarioError(request, safeCode, "The scenario turn could not be saved.", safeCode === "SCENARIO_SESSION_NOT_FOUND" ? 404 : 409);
  }
}
