import { NextRequest } from "next/server";
import { z } from "zod";

import { completeScenarioSession, createDrizzleScenarioPracticeRepository } from "@/src/modules/scenario-practice";
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
    const turns = await repository.listTurns(user.id, sessionId);
    const expressionSnapshot = turns.filter((turn) => turn.speaker === "user" && turn.status === "completed").map((turn) => turn.text);
    if (expressionSnapshot.length === 0) return scenarioError(request, "SCENARIO_SESSION_CONFLICT", "A completed user turn is required.", 409);
    const completed = await completeScenarioSession(repository, {
      userId: user.id,
      sessionId,
      expectedRevision: session.revision,
      idempotencyKey: parsed.data.idempotencyKey,
      expressionSnapshot,
      goalSnapshot: session.communicationGoal,
      variantRequirements: [
        { kind: "character", value: session.temporaryCharacter.role },
        { kind: "condition", value: "改变人物、地点、条件或表达槽位中的至少一项" },
      ],
      now: () => new Date(),
      makeRepetitionId: () => crypto.randomUUID(),
    });
    return scenarioData({ session: completed.session, repetitions: completed.repetitionItems, persistence: "account" });
  } catch { return scenarioError(request, "SCENARIO_SESSION_CONFLICT", "The scenario session changed before completion.", 409, true); }
}
