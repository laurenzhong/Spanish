import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createDrizzleIntroductionRepository,
  proposeIntroduction,
} from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

const proposalSchema = z.object({
  targetCharacterKey: z.enum(["mateo", "ines"]),
  recentMessages: z.array(z.object({ role: z.enum(["user", "character"]), content: z.string().max(2_000) })).max(20).optional(),
  contentEvent: z.object({ packKey: z.string().min(1).max(160), relation: z.enum(["shared-interest", "life-context"]) }).optional(),
  userInterests: z.array(z.string().min(1).max(120)).max(20).optional(),
});

function errorResponse(code: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, retryable: status >= 500 } }, { status });
}

function recordJson(record: Awaited<ReturnType<ReturnType<typeof createDrizzleIntroductionRepository>["listPending"]>>[number]) {
  return {
    offerKey: record.offerKey,
    sourceCharacterKey: record.sourceCharacterKey,
    targetCharacterKey: record.targetCharacterKey,
    reasonCode: record.reasonCode,
    reasonText: record.reasonText,
    status: record.status,
    expiresAt: record.expiresAt?.toISOString() ?? null,
  };
}

export async function GET(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) return NextResponse.json({ data: { offers: [] } });
  try {
    const repository = createDrizzleIntroductionRepository(getDatabase());
    const offers = await repository.listPending(user.id);
    return NextResponse.json({ data: { offers: offers.map(recordJson) } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  }
}

export async function POST(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("INPUT_INVALID", 400); }
  const parsed = proposalSchema.safeParse(body);
  if (!parsed.success) return errorResponse("INPUT_INVALID", 400);
  if (!process.env.DATABASE_URL) return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  try {
    const repository = createDrizzleIntroductionRepository(getDatabase());
    const result = await proposeIntroduction({
      repository,
      candidate: {
        userId: user.id,
        sourceCharacterKey: "lucia",
        sourceCharacterVersion: 1,
        targetCharacterKey: parsed.data.targetCharacterKey,
        targetCharacterVersion: 1,
        recentMessages: parsed.data.recentMessages,
        contentEvent: parsed.data.contentEvent,
        userInterests: parsed.data.userInterests,
      },
    });
    if (!result.offer) return new NextResponse(null, { status: 204 });
    return NextResponse.json({ data: { offer: recordJson(result.offer) } }, { status: 201 });
  } catch {
    return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  }
}
