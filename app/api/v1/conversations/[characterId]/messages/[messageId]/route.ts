import { NextRequest, NextResponse } from "next/server";

import {
  createDrizzleConversationRepository,
  findConversationCharacter,
} from "@/src/modules/conversation";
import { deleteMemoriesForSourceMessage, createDrizzleMemoryRepository } from "@/src/modules/memory";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ characterId: string; messageId: string }> }>;

function error(code: string, status: number) {
  return NextResponse.json({ error: { code, retryable: status >= 500 } }, { status });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

async function authorize(request: NextRequest, characterId: string) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return { user: null, response: error("AUTH_REQUIRED", 401) } as const;
  if (!findConversationCharacter(characterId)) return { user: null, response: error("CHARACTER_UNAVAILABLE", 404) } as const;
  if (!process.env.DATABASE_URL) return { user: null, response: error("CONVERSATION_UNAVAILABLE", 503) } as const;
  return { user, response: null } as const;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { characterId, messageId } = await context.params;
  const auth = await authorize(request, characterId);
  if (auth.response) return auth.response;
  if (!isUuid(messageId)) return error("MESSAGE_NOT_FOUND", 404);
  try {
    const deleted = await createDrizzleConversationRepository(getDatabase()).deleteMessage(auth.user.id, characterId, messageId);
    return deleted ? NextResponse.json({ data: { deleted: true } }) : error("MESSAGE_NOT_FOUND", 404);
  } catch {
    return error("CONVERSATION_UNAVAILABLE", 503);
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { characterId, messageId } = await context.params;
  const auth = await authorize(request, characterId);
  if (auth.response) return auth.response;
  if (!isUuid(messageId)) return error("MESSAGE_NOT_FOUND", 404);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error("INPUT_INVALID", 400);
  }
  if (!body || typeof body !== "object" || (body as { action?: unknown }).action !== "withdraw") {
    return error("INPUT_INVALID", 400);
  }
  try {
    const database = getDatabase();
    const repository = createDrizzleConversationRepository(database);
    const memoryRepository = createDrizzleMemoryRepository(database);
    const withdrawn = await repository.withdrawMessage(auth.user.id, characterId, messageId);
    if (!withdrawn) return error("WITHDRAWAL_EXPIRED", 409);
    if (memoryRepository.deleteBySourceMessage) {
      await deleteMemoriesForSourceMessage(memoryRepository, auth.user.id, messageId);
    }
    return NextResponse.json({ data: { withdrawn: true } });
  } catch {
    return error("CONVERSATION_UNAVAILABLE", 503);
  }
}
