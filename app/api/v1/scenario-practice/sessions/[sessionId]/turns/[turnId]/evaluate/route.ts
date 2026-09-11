import { NextRequest } from "next/server";
import { z } from "zod";

import { createMiniMaxScenarioEvaluationProvider } from "@/src/modules/providers/scenario-evaluation/server";
import { FakeScenarioEvaluationProvider, ScenarioProviderError } from "@/src/modules/providers/scenario-evaluation";
import { createDrizzleScenarioLibraryRepository, evaluateScenarioTurn, getScenarioPracticeDetailForUser } from "@/src/modules/scenario-practice";
import { createDrizzleScenarioPracticeRepository, createScenarioEvidenceInput } from "@/src/modules/scenario-practice";
import { createDrizzleEvidenceRepository, recordEvidence } from "@/src/modules/evidence";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import * as databaseSchema from "@/src/shared/db/schema";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

export const runtime = "nodejs";

const requestSchema = z.strictObject({
  scenarioKey: z.string().min(1).max(160), generationId: z.string().min(1).max(128),
  persist: z.boolean(),
  modality: z.enum(["speech", "typing"]), hintLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  transcriptConfidence: z.number().min(0).max(1).nullable(),
  completedTurns: z.array(z.strictObject({ turnId: z.string().min(1).max(128), speaker: z.enum(["user", "temporary-character", "condition"]), text: z.string().min(1).max(4_000) })).max(30),
});

export async function POST(request: NextRequest, { params }: Readonly<{ params: Promise<{ sessionId: string; turnId: string }> }>) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return scenarioError(request, "AUTH_REQUIRED", "Authentication is required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return scenarioError(request, "VALIDATION_FAILED", "The evaluation request is invalid.", 400);
  const isPersonal = parsed.data.scenarioKey.startsWith("personal.");
  const scenario = await getScenarioPracticeDetailForUser(process.env.DATABASE_URL ? createDrizzleScenarioLibraryRepository(getDatabase()) : null, parsed.data.scenarioKey, user.id).catch(() => null);
  if (!scenario || (!isPersonal && process.env.NODE_ENV === "production" && scenario.status !== "published")) return scenarioError(request, "SCENARIO_NOT_FOUND", "The scenario was not found.", 404);
  const { sessionId, turnId } = await params;
  if (parsed.data.modality === "speech" && parsed.data.transcriptConfidence !== null && parsed.data.transcriptConfidence < 0.6) {
    return scenarioData(null, { status: 202, headers: { "x-review-status": "unavailable", "x-review-reason": "low-confidence-transcript" } });
  }
  try {
    const provider = process.env.NODE_ENV !== "production" && process.env.AUTH_E2E_ENABLED === "1" ? new FakeScenarioEvaluationProvider() : createMiniMaxScenarioEvaluationProvider();
    const data = await evaluateScenarioTurn({ provider, scenario,
      requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(), sessionId, signal: request.signal, ...parsed.data });
    if (parsed.data.persist) {
      if (!process.env.DATABASE_URL) throw new Error("SCENARIO_SESSION_NOT_FOUND");
      const database = getDatabase();
      const repository = createDrizzleScenarioPracticeRepository(database);
      const turn = await repository.getTurn(user.id, sessionId, turnId);
      if (!turn || turn.speaker !== "user" || turn.status !== "completed" || turn.modality !== parsed.data.modality) throw new Error("SCENARIO_TURN_CONFLICT");
      const turnErrors = data.errors.filter((error) => error.turnId === turnId);
      const review = await repository.saveTurnReview({
        id: crypto.randomUUID(), userId: user.id, turnId, communicationSuccess: data.contextualSuccess,
        errorSpans: turnErrors, naturalAlternatives: turnErrors.flatMap((error) => error.naturalAlternative ? [error.naturalAlternative] : []),
        hintLevel: parsed.data.hintLevel, transcriptConfidence: parsed.data.transcriptConfidence,
        algorithmVersion: "scenario-evaluation-v1", providerKey: data.provider, modelVersion: data.modelVersion,
        providerRequestId: data.providerRequestId, status: "ready",
      });
      const evidenceInput = createScenarioEvidenceInput({
        turn, contextualSuccess: data.contextualSuccess, hintLevel: parsed.data.hintLevel,
        transcriptConfidence: parsed.data.transcriptConfidence, contentVersion: scenario.version,
        skillKeys: scenario.tasks.map((task) => task.goalKey), idempotencyKey: `scenario-review:${review.id}`,
      });
      if (evidenceInput) {
        await database.insert(databaseSchema.practiceAttempts).values({
          id: turn.id, userId: user.id, sessionId, clientAttemptId: `scenario:${turn.id}`,
          modality: turn.modality, responseText: turn.text, hintLevel: parsed.data.hintLevel,
          transcriptConfidence: parsed.data.transcriptConfidence, evaluation: { contextualSuccess: data.contextualSuccess, reviewId: review.id },
          contentVersion: scenario.version, algorithmVersion: "scenario-evaluation-v1",
        }).onConflictDoNothing({ target: [databaseSchema.practiceAttempts.userId, databaseSchema.practiceAttempts.clientAttemptId] });
        await recordEvidence(createDrizzleEvidenceRepository(database), evidenceInput, { requestId: request.headers.get("x-request-id") ?? undefined });
      }
    }
    return scenarioData(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error instanceof ScenarioProviderError ? error.code : "provider-unavailable";
    const retryable = error instanceof ScenarioProviderError ? error.retryable : true;
    const apiCode = code === "PROVIDER_NOT_CONFIGURED" ? "PROVIDER_NOT_CONFIGURED" : code === "provider-timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE";
    return scenarioError(request, apiCode, "Scenario evaluation is temporarily unavailable.", code === "provider-rate-limited" ? 429 : 503, retryable);
  }
}
