import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createDrizzleIntroductionRepository,
  proposeIntroduction,
} from "@/src/modules/character-network";
import {
  CharacterRuntimeError,
  resolveConversationCharacter,
} from "@/src/modules/conversation";
import { createDrizzleCharacterRepository } from "@/src/modules/characters";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const proposalSchema = z.object({
  targetCharacterKey: z.enum(["mateo", "ines"]),
  recentMessages: z.array(z.object({ role: z.enum(["user", "character"]), content: z.string().max(2_000) })).max(20).optional(),
  contentEvent: z.object({ packKey: z.string().min(1).max(160), relation: z.enum(["shared-interest", "life-context"]) }).optional(),
  userInterests: z.array(z.string().min(1).max(120)).max(20).optional(),
});

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  AUTH_REQUIRED: "A valid user session is required.",
  INPUT_INVALID: "The introduction request is invalid.",
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
      message: ERROR_MESSAGES[code] ?? "The introduction request failed.",
      retryable: status >= 500,
    },
  }, { status });
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
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  try {
    const database = getDatabase();
    const characterRepository = createDrizzleCharacterRepository(database);
    const repository = createDrizzleIntroductionRepository(database);
    const offers = await repository.listPending(user.id);
    const offerPayloads = (await Promise.all(offers.map(async (offer) => {
      try {
        await resolveConversationCharacter({
          characterKey: offer.sourceCharacterKey,
          characterVersion: offer.sourceCharacterVersion,
          requiredCapability: "introductions",
          repository: characterRepository,
        });
        await resolveConversationCharacter({
          characterKey: offer.targetCharacterKey,
          characterVersion: offer.targetCharacterVersion,
          requiredCapability: "introductions",
          repository: characterRepository,
        });
        return {
          ...recordJson(offer),
          shareableMemories: await repository.listShareableMemoryPreviews(
            user.id,
            offer.sourceCharacterKey,
            offer.targetCharacterKey,
            offer.sourceCharacterVersion,
            offer.targetCharacterVersion,
          ),
        };
      } catch {
        // Offers created before a character was retired/drafted remain in the
        // database for auditability, but must not block the live inbox.
        return null;
      }
    }))).filter((offer): offer is NonNullable<typeof offer> => offer !== null);
    return NextResponse.json({ apiVersion: API_VERSION, data: { offers: offerPayloads } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  }
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("INPUT_INVALID", 400); }
  const parsed = proposalSchema.safeParse(body);
  if (!parsed.success) return errorResponse("INPUT_INVALID", 400);
  if (!process.env.DATABASE_URL) return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  try {
    const database = getDatabase();
    await resolveConversationCharacter({
      characterKey: "lucia",
      characterVersion: 1,
      requiredCapability: "introductions",
      repository: createDrizzleCharacterRepository(database),
    });
    await resolveConversationCharacter({
      characterKey: parsed.data.targetCharacterKey,
      characterVersion: 1,
      requiredCapability: "introductions",
      repository: createDrizzleCharacterRepository(database),
    });
    const repository = createDrizzleIntroductionRepository(database);
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
    return NextResponse.json({ apiVersion: API_VERSION, data: { offer: recordJson(result.offer) } }, { status: 201 });
  } catch (error) {
    if (error instanceof CharacterRuntimeError) {
      return errorResponse(error.code === "CHARACTER_UNAVAILABLE" ? "CHARACTER_UNAVAILABLE" : "INTRODUCTION_UNAVAILABLE", error.code === "CHARACTER_UNAVAILABLE" ? 404 : 503);
    }
    return errorResponse("INTRODUCTION_UNAVAILABLE", 503);
  }
}
