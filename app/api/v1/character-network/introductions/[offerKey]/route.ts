import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createDrizzleIntroductionRepository,
  respondToIntroduction,
  IntroductionError,
} from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ offerKey: string }> }>;
const responseSchema = z.object({ decision: z.enum(["accept", "decline"]), memoryIds: z.array(z.string().uuid()).max(20).optional() });

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  AUTH_REQUIRED: "A valid user session is required.",
  INPUT_INVALID: "The introduction response is invalid.",
  CHARACTER_UNAVAILABLE: "This character is not available.",
  INTRODUCTION_UNAVAILABLE: "Character introductions are temporarily unavailable.",
  INTRODUCTION_NOT_AVAILABLE: "This introduction is no longer available.",
  INTRODUCTION_MEMORY_NOT_SHAREABLE: "The selected memory cannot be shared.",
  INTRODUCTION_EXPIRED: "This introduction has expired.",
  INTRODUCTION_ALREADY_RESOLVED: "This introduction has already been resolved.",
};

function errorResponse(code: ApiErrorCode, status: number): NextResponse {
  return NextResponse.json({
    apiVersion: API_VERSION,
    error: {
      code,
      message: ERROR_MESSAGES[code] ?? "The introduction response failed.",
      retryable: status >= 500,
    },
  }, { status });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("INPUT_INVALID", 400); }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) return errorResponse("INPUT_INVALID", 400);
  const { offerKey } = await context.params;
  try {
    const repository = createDrizzleIntroductionRepository(getDatabase());
    const result = await respondToIntroduction({
      repository,
      userId: user.id,
      offerKey,
      decision: parsed.data.decision,
      memoryIds: parsed.data.memoryIds,
    });
    if ("relationship" in result) {
      return NextResponse.json({ apiVersion: API_VERSION, data: {
        status: result.offer.status,
        targetCharacterKey: result.offer.targetCharacterKey,
        relationshipStage: result.relationship.relationshipStage,
        conversationId: result.conversationId,
        sharedMemoryIds: result.sharedMemoryIds,
      } });
    }
    return NextResponse.json({ apiVersion: API_VERSION, data: { status: result.status, targetCharacterKey: result.targetCharacterKey } });
  } catch (error) {
    if (error instanceof IntroductionError) {
      const status = error.code === "INTRODUCTION_NOT_AVAILABLE" ? 404 : error.code === "INTRODUCTION_MEMORY_NOT_SHAREABLE" ? 403 : 409;
      return errorResponse(error.code, status);
    }
    if (error instanceof Error && error.message === "CHARACTER_UNAVAILABLE") {
      return errorResponse("CHARACTER_UNAVAILABLE", 404);
    }
    return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  }
}
