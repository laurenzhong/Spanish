import { NextRequest } from "next/server";
import { z } from "zod";

import { FakeScenarioRoleplayProvider, ScenarioProviderError } from "@/src/modules/providers/scenario-roleplay";
import { createScenarioRoleplayProviders } from "@/src/modules/providers/scenario-runtime";
import { observeScenarioRoleplayProvider } from "@/src/modules/providers/observed-scenario-providers";
import { createDrizzleProviderCallRepository } from "@/src/modules/providers/repositories/drizzle-provider-call-repository";
import { createDrizzleScenarioLibraryRepository, getScenarioPracticeDetailForUser, streamScenarioReply } from "@/src/modules/scenario-practice";
import { createDrizzleScenarioPracticeRepository } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { scenarioError } from "@/app/api/v1/scenario-practice/http";

export const runtime = "nodejs";

const requestSchema = z.strictObject({
  scenarioKey: z.string().min(1).max(160),
  generationId: z.string().min(1).max(128),
  characterTurnId: z.string().uuid(),
  turnIndex: z.number().int().nonnegative(),
  persist: z.boolean(),
  completedTurns: z.array(z.strictObject({ speaker: z.enum(["user", "temporary-character", "condition"]), text: z.string().min(1).max(4_000) })).max(30),
  triggeredConditions: z.array(z.string().min(1).max(160)).max(10),
});

export async function POST(request: NextRequest, { params }: Readonly<{ params: Promise<{ sessionId: string; turnId: string }> }>) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return scenarioError(request, "VALIDATION_FAILED", "The roleplay request is invalid.", 400);
  const isPersonal = parsed.data.scenarioKey.startsWith("personal.");
  const scenario = await getScenarioPracticeDetailForUser(process.env.DATABASE_URL ? createDrizzleScenarioLibraryRepository(getDatabase()) : null, parsed.data.scenarioKey, user.id).catch(() => null);
  if (!scenario || (!isPersonal && process.env.NODE_ENV === "production" && scenario.status !== "published")) return scenarioError(request, "SCENARIO_NOT_FOUND", "The scenario was not found.", 404);
  const { sessionId, turnId } = await params;
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        let completeText = "";
        let persistedCondition = false;
        let completedProviderKey: string | null = null;
        let completedModelVersion: string | null = null;
        const database = process.env.DATABASE_URL ? getDatabase() : null;
        const provider = process.env.NODE_ENV !== "production" && process.env.AUTH_E2E_ENABLED === "1"
          ? new FakeScenarioRoleplayProvider()
          : (await createScenarioRoleplayProviders(user.id)).map((candidate) =>
              observeScenarioRoleplayProvider(candidate, database ? createDrizzleProviderCallRepository(database) : undefined, user.id));
        for await (const frame of streamScenarioReply({
          provider, scenario, requestId, sessionId,
          generationId: parsed.data.generationId, completedTurns: parsed.data.completedTurns,
          triggeredConditions: parsed.data.triggeredConditions, signal: request.signal,
        })) {
          if (frame.type === "meta") {
            completedProviderKey = frame.provider;
            const candidates = Array.isArray(provider) ? provider : [provider];
            completedModelVersion = candidates.find((candidate) => candidate.key === frame.provider)?.modelVersion ?? null;
          }
          if (frame.type === "delta") completeText += frame.text;
          if (frame.type === "condition" && parsed.data.persist) {
            if (!process.env.DATABASE_URL) throw new Error("SCENARIO_SESSION_NOT_FOUND");
            await createDrizzleScenarioPracticeRepository(getDatabase()).appendCompletedConditionTurn({
              id: crypto.randomUUID(), userId: user.id, sessionId,
              clientAttemptId: `${parsed.data.generationId}:condition:${frame.stableKey}`,
              turnIndex: parsed.data.turnIndex, speaker: "condition", modality: "system", text: frame.text,
              generationId: parsed.data.generationId, replyToTurnId: turnId,
            });
            persistedCondition = true;
          }
          if (frame.type === "done" && parsed.data.persist) {
            if (!process.env.DATABASE_URL) throw new Error("SCENARIO_SESSION_NOT_FOUND");
            await createDrizzleScenarioPracticeRepository(getDatabase()).appendCompletedRoleplayTurn({
              id: parsed.data.characterTurnId, userId: user.id, sessionId, clientAttemptId: parsed.data.generationId,
              turnIndex: parsed.data.turnIndex + (persistedCondition ? 1 : 0), speaker: "temporary-character", modality: "system", text: completeText,
              generationId: parsed.data.generationId, replyToTurnId: turnId,
              providerKey: completedProviderKey,
              modelVersion: completedModelVersion,
              done: true,
            });
          }
          controller.enqueue(encoder.encode(`${JSON.stringify(frame)}\n`));
        }
      } catch (error) {
        const code = error instanceof ScenarioProviderError ? error.code : error instanceof Error && error.message === "SCENARIO_REPLY_INCOMPLETE" ? "SCENARIO_REPLY_INCOMPLETE" : "provider-unavailable";
        const retryable = error instanceof ScenarioProviderError ? error.retryable : true;
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", code, retryable })}\n`));
      } finally { controller.close(); }
    },
    cancel() { /* request.signal owns provider cancellation */ },
  });
  return new Response(body, { headers: { "cache-control": "no-store", "content-type": "application/x-ndjson; charset=utf-8", "x-content-type-options": "nosniff" } });
}
