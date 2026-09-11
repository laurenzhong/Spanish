import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { z } from "zod";

import { createDrizzleScenarioPracticeRepository, getScenarioPracticeDetail } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

const requestSchema = z.strictObject({ sessionId: z.string().uuid(), clientAttemptId: z.string().min(1).max(128), scenarioKey: z.string().min(1).max(160), primaryModality: z.enum(["speech", "typing"]) });

export async function POST(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return scenarioError(request, "VALIDATION_FAILED", "The scenario session request is invalid.", 400);
  const detail = getScenarioPracticeDetail(parsed.data.scenarioKey);
  if (!detail || (process.env.NODE_ENV === "production" && detail.status !== "published")) return scenarioError(request, "SCENARIO_NOT_FOUND", "The scenario was not found.", 404);
  if (!process.env.DATABASE_URL) return scenarioData({ sessionId: parsed.data.sessionId, persistence: "device" }, { status: 201 });
  try {
    const database = getDatabase();
    const [record] = await database.select({ id: schema.scenarios.id }).from(schema.scenarios)
      .where(and(eq(schema.scenarios.stableKey, detail.stableKey), eq(schema.scenarios.contentVersion, detail.version))).limit(1);
    if (!record) return scenarioData({ sessionId: parsed.data.sessionId, persistence: "device" }, { status: 201 });
    const session = await createDrizzleScenarioPracticeRepository(database).createSession({
      sessionId: parsed.data.sessionId, userId: user.id, clientAttemptId: parsed.data.clientAttemptId,
      scenarioId: record.id, primaryModality: parsed.data.primaryModality, contentVersion: detail.version,
      communicationGoal: detail.tasks.map((task) => task.prompt).join("；"),
      temporaryCharacter: { displayName: detail.temporaryCharacter.displayName, role: detail.temporaryCharacter.role, locale: detail.temporaryCharacter.locale },
    });
    return scenarioData({ sessionId: session.sessionId, persistence: "account", revision: session.revision }, { status: 201 });
  } catch {
    return scenarioError(request, "SCENARIO_SESSION_UNAVAILABLE", "The scenario session could not be saved.", 503, true);
  }
}
