import { NextRequest, NextResponse } from "next/server";

import {
  CharacterRuntimeError,
  createDrizzleConversationRepository,
  findConversationCharacter,
  isConversationStaticFallbackAllowed,
  resolveConversationCharacter,
} from "@/src/modules/conversation";
import { createDrizzleCharacterRepository } from "@/src/modules/characters";
import { deleteMemoriesForSourceMessage, createDrizzleMemoryRepository } from "@/src/modules/memory";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ characterId: string; messageId: string }> }>;

function error(code: string, status: number, message: string) {
  return NextResponse.json({ apiVersion: API_VERSION, error: { code, message, retryable: status >= 500 } }, { status });
}

const ERROR_MESSAGES = {
  AUTH_REQUIRED: "A valid user session is required.",
  CHARACTER_UNAVAILABLE: "This character is not available.",
  CONVERSATION_UNAVAILABLE: "Conversation messages are temporarily unavailable.",
  INPUT_INVALID: "The message request is invalid.",
  MESSAGE_NOT_FOUND: "This message was not found.",
  WITHDRAWAL_EXPIRED: "This message can no longer be withdrawn.",
} as const;

function errorResponse(code: keyof typeof ERROR_MESSAGES, status: number) {
  return error(code, status, ERROR_MESSAGES[code]);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

async function authorize(request: NextRequest, characterId: string) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return { user: null, response: errorResponse("AUTH_REQUIRED", 401) } as const;
  if (!findConversationCharacter(characterId)) return { user: null, response: errorResponse("CHARACTER_UNAVAILABLE", 404) } as const;
  if (!process.env.DATABASE_URL) return { user: null, response: errorResponse("CONVERSATION_UNAVAILABLE", 503) } as const;
  try {
    const database = getDatabase();
    await resolveConversationCharacter({
      characterKey: characterId,
      characterVersion: 1,
      repository: process.env.NODE_ENV !== "test" ? createDrizzleCharacterRepository(database) : undefined,
      allowStaticFallback: isConversationStaticFallbackAllowed(),
    });
  } catch (reason) {
    const unavailable = reason instanceof CharacterRuntimeError && reason.code === "CHARACTER_UNAVAILABLE";
    return { user: null, response: errorResponse(unavailable ? "CHARACTER_UNAVAILABLE" : "CONVERSATION_UNAVAILABLE", unavailable ? 404 : 503) } as const;
  }
  return { user, response: null } as const;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { characterId, messageId } = await context.params;
  const auth = await authorize(request, characterId);
  if (auth.response) return auth.response;
  if (!isUuid(messageId)) return errorResponse("MESSAGE_NOT_FOUND", 404);
  try {
    const deleted = await createDrizzleConversationRepository(getDatabase()).deleteMessage(auth.user.id, characterId, messageId);
    if (!deleted) return errorResponse("MESSAGE_NOT_FOUND", 404);
    try {
      await deleteMemoriesForSourceMessage(
        createDrizzleMemoryRepository(getDatabase()),
        auth.user.id,
        messageId,
      );
    } catch {
      // Message deletion is complete; memory cleanup remains retryable and
      // must not turn the successful user action into a duplicate delete.
    }
    return NextResponse.json({ apiVersion: API_VERSION, data: { deleted: true } });
  } catch {
    return errorResponse("CONVERSATION_UNAVAILABLE", 503);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { characterId, messageId } = await context.params;
  const auth = await authorize(request, characterId);
  if (auth.response) return auth.response;
  if (!isUuid(messageId)) return errorResponse("MESSAGE_NOT_FOUND", 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INPUT_INVALID", 400);
  }
  if (!body || typeof body !== "object" || (body as { action?: unknown }).action !== "withdraw") {
    return errorResponse("INPUT_INVALID", 400);
  }
  try {
    const database = getDatabase();
    const repository = createDrizzleConversationRepository(database);
    const memoryRepository = createDrizzleMemoryRepository(database);
    const withdrawn = await repository.withdrawMessage(auth.user.id, characterId, messageId);
    if (!withdrawn) return errorResponse("WITHDRAWAL_EXPIRED", 409);
    if (memoryRepository.deleteBySourceMessage) {
      await deleteMemoriesForSourceMessage(memoryRepository, auth.user.id, messageId);
    }
    return NextResponse.json({ apiVersion: API_VERSION, data: { withdrawn: true } });
  } catch {
    return errorResponse("CONVERSATION_UNAVAILABLE", 503);
  }
}
