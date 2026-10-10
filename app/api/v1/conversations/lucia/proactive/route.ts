import { NextRequest, NextResponse } from "next/server";

import {
  generateLuciaProactiveMessage,
  previewLuciaProactiveMessage,
  proactiveMessageSources,
  proactiveDailyStates,
  createDrizzleProactiveMessageRepository,
  CharacterRuntimeError,
  resolveConversationCharacter,
} from "@/src/modules/conversation";
import { createDrizzleCharacterRepository } from "@/src/modules/characters";
import { createDrizzleMemoryRepository } from "@/src/modules/memory";
import { createMiniMaxConversationProvider, createOpenAIConversationProvider } from "@/src/modules/providers/conversation/server";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  AUTH_REQUIRED: "A valid user session is required.",
  INPUT_INVALID: "The proactive message request is invalid.",
  CHARACTER_UNAVAILABLE: "Lucía is not available for proactive messages.",
  PROACTIVE_UNAVAILABLE: "Proactive messages are temporarily unavailable.",
};

function errorResponse(code: ApiErrorCode, status: number): NextResponse {
  return NextResponse.json({
    apiVersion: API_VERSION,
    error: {
      code,
      message: ERROR_MESSAGES[code] ?? "The proactive message request failed.",
      retryable: status >= 500,
    },
  }, { status });
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) {
    return errorResponse("PROACTIVE_UNAVAILABLE", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INPUT_INVALID", 400);
  }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const source = typeof input.sourceType === "string" ? input.sourceType : "";
  // Milestones are emitted only by a future relationship-event application
  // flow, never by a client-controlled trigger.
  const clientTriggerSources = proactiveMessageSources.filter((value) => value !== "relationship_milestone");
  if (!clientTriggerSources.includes(source as (typeof clientTriggerSources)[number])) {
    return errorResponse("INPUT_INVALID", 400);
  }
  const sourceEventId = input.sourceEventId === undefined || input.sourceEventId === null
    ? null
    : typeof input.sourceEventId === "string" && input.sourceEventId.length <= 200
      ? input.sourceEventId
      : "__invalid__";
  if (sourceEventId === "__invalid__") return errorResponse("INPUT_INVALID", 400);
  const dailyState = input.dailyState === undefined ? "available" : input.dailyState;
  if (!proactiveDailyStates.includes(dailyState as (typeof proactiveDailyStates)[number])) {
    return errorResponse("INPUT_INVALID", 400);
  }
  let testNow: Date | undefined;
  if (input.testNow !== undefined) {
    if (process.env.NODE_ENV === "production" || typeof input.testNow !== "string") {
      return errorResponse("INPUT_INVALID", 400);
    }
    const parsed = new Date(input.testNow);
    const maxFutureMs = 8 * 24 * 60 * 60 * 1_000;
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() < Date.now() || parsed.getTime() > Date.now() + maxFutureMs) {
      return errorResponse("INPUT_INVALID", 400);
    }
    testNow = parsed;
  }

  try {
    const database = getDatabase();
    try {
      await resolveConversationCharacter({
        characterKey: "lucia",
        characterVersion: 1,
        requiredCapability: "proactiveMessages",
        repository: createDrizzleCharacterRepository(database),
      });
    } catch (error) {
      const unavailable = error instanceof CharacterRuntimeError && error.code === "CHARACTER_UNAVAILABLE";
      return errorResponse(unavailable ? "CHARACTER_UNAVAILABLE" : "PROACTIVE_UNAVAILABLE", unavailable ? 404 : 503);
    }
    const configuredProvider = process.env.CONVERSATION_PROVIDER?.trim().toLowerCase();
    const useOpenAI = configuredProvider === "openai" && Boolean(process.env.OPENAI_API_KEY?.trim());
    const useMiniMax = !useOpenAI && Boolean(process.env.MINIMAX_API_KEY?.trim());
    const provider = useOpenAI
      ? createOpenAIConversationProvider()
      : useMiniMax
        ? createMiniMaxConversationProvider()
        : undefined;
    if (!provider && process.env.NODE_ENV === "production") {
      return errorResponse("PROACTIVE_UNAVAILABLE", 503);
    }
    const memoryRepository = createDrizzleMemoryRepository(database);
    const memories = await memoryRepository.listReadableMemories(user.id, "lucia");
    if (input.preview === true && process.env.NODE_ENV !== "production") {
      const preview = await previewLuciaProactiveMessage({
        userId: user.id,
        source: source as (typeof proactiveMessageSources)[number],
        dailyState: dailyState as (typeof proactiveDailyStates)[number],
        repository: createDrizzleProactiveMessageRepository(database),
        provider,
        memories,
      });
      return NextResponse.json({ apiVersion: API_VERSION, data: preview }, { status: preview.status === "preview" ? 200 : 422, headers: { "cache-control": "no-store" } });
    }
    const result = await generateLuciaProactiveMessage({
      userId: user.id,
      source: source as (typeof proactiveMessageSources)[number],
      sourceEventId,
      dailyState: dailyState as (typeof proactiveDailyStates)[number],
      now: testNow,
      repository: createDrizzleProactiveMessageRepository(database),
      provider,
      memories,
    });
    return NextResponse.json({ apiVersion: API_VERSION,
      data: {
        status: result.status,
        reason: result.reason ?? null,
        candidateId: result.candidate?.id ?? null,
        messageId: result.message?.id ?? result.candidate?.messageId ?? null,
      },
    }, { status: result.status === "generated" ? 201 : 200, headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("PROACTIVE_UNAVAILABLE", 503);
  }
}
