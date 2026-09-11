import { NextRequest } from "next/server";
import { z } from "zod";

import { createDrizzleScenarioPracticeRepository } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

const schema = z.strictObject({ idempotencyKey: z.string().min(1).max(128) });
export async function POST(request: NextRequest, { params }: Readonly<{ params: Promise<{ sessionId: string }> }>) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser()); if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return scenarioError(request, "VALIDATION_FAILED", "The completion request is invalid.", 400);
  if (!process.env.DATABASE_URL) return scenarioData({ persistence: "device" }, { status: 202 });
  const { sessionId } = await params;
  try {
    const repository = createDrizzleScenarioPracticeRepository(getDatabase()); const session = await repository.getSession(user.id, sessionId);
    if (!session) return scenarioError(request, "SCENARIO_SESSION_NOT_FOUND", "The scenario session was not found.", 404);
    const completed = await repository.completeSession({ userId: user.id, sessionId, expectedRevision: session.revision, idempotencyKey: parsed.data.idempotencyKey, completedAt: new Date(), repetitionItems: [] });
    return scenarioData({ session: completed, persistence: "account" });
  } catch { return scenarioError(request, "SCENARIO_SESSION_CONFLICT", "The scenario session changed before completion.", 409, true); }
}
