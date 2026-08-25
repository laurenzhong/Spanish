import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createDrizzleIntroductionRepository,
  respondToIntroduction,
  IntroductionError,
} from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ offerKey: string }> }>;
const responseSchema = z.object({ decision: z.enum(["accept", "decline"]), memoryIds: z.array(z.string().uuid()).max(20).optional() });

function errorResponse(code: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, retryable: status >= 500 } }, { status });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
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
      return NextResponse.json({ data: {
        status: result.offer.status,
        targetCharacterKey: result.offer.targetCharacterKey,
        relationshipStage: result.relationship.relationshipStage,
        conversationId: result.conversationId,
        sharedMemoryIds: result.sharedMemoryIds,
      } });
    }
    return NextResponse.json({ data: { status: result.status, targetCharacterKey: result.targetCharacterKey } });
  } catch (error) {
    if (error instanceof IntroductionError) {
      const status = error.code === "INTRODUCTION_NOT_AVAILABLE" ? 404 : error.code === "INTRODUCTION_MEMORY_NOT_SHAREABLE" ? 403 : 409;
      return errorResponse(error.code, status);
    }
    return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  }
}
