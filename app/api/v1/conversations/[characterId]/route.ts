import { NextRequest, NextResponse } from "next/server";

import {
  CharacterRuntimeError,
  createDrizzleConversationRepository,
  isConversationStaticFallbackAllowed,
  listConversationHistory,
  resolveConversationCharacter,
  findConversationCharacter,
} from "@/src/modules/conversation";
import { createDrizzleCharacterRepository } from "@/src/modules/characters";
import {
  createDrizzleIntroductionRepository,
  createDrizzleLuciaContactRepository,
} from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ characterId: string }> }>;
type ConversationContactStatus = "pending" | "active" | "declined" | "unavailable";

type ConversationHistoryAccess = Readonly<{
  readOnly: boolean;
  canSend: boolean;
  contactStatus: ConversationContactStatus;
}>;

/**
 * A history read must remain useful when the contact gate is not currently
 * readable, but it must never turn that uncertainty into send permission.
 * The stream route re-checks the same relationship before writing anything.
 */
async function resolveHistoryAccess(
  database: ReturnType<typeof getDatabase>,
  userId: string,
  characterKey: string,
): Promise<ConversationHistoryAccess> {
  try {
    if (characterKey === "lucia") {
      const contact = await createDrizzleLuciaContactRepository(database).get(userId);
      return contact.status === "active"
        ? { readOnly: false, canSend: true, contactStatus: "active" }
        : { readOnly: true, canSend: false, contactStatus: contact.status };
    }

    const statusReader = createDrizzleIntroductionRepository(database).getRelationshipStatus;
    if (!statusReader) {
      return { readOnly: true, canSend: false, contactStatus: "unavailable" };
    }
    const status = await statusReader(userId, characterKey, 1);
    // A published character without a relationship is waiting for an
    // introduction/acceptance, rather than being a persistence failure.
    if (status === "active") return { readOnly: false, canSend: true, contactStatus: "active" };
    if (status === "declined") return { readOnly: true, canSend: false, contactStatus: "declined" };
    return { readOnly: true, canSend: false, contactStatus: "pending" };
  } catch {
    return { readOnly: true, canSend: false, contactStatus: "unavailable" };
  }
}

function serverTiming(entries: Readonly<Record<string, number>>): string {
  return Object.entries(entries)
    .map(([name, duration]) => `${name};dur=${Math.max(0, Math.round(duration))}`)
    .join(", ");
}

function errorResponse(
  code: string,
  status: number,
  message: string,
  headers?: HeadersInit,
  retryable = status >= 500,
) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, retryable } },
    { status, headers },
  );
}

export async function GET(request: NextRequest, context: RouteContext) {
  const startedAt = Date.now();
  const authStartedAt = startedAt;
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  const authMs = Date.now() - authStartedAt;
  if (!user) return errorResponse(
    "AUTH_REQUIRED",
    401,
    "A valid user session is required.",
    { "cache-control": "no-store", "server-timing": serverTiming({ auth: authMs, total: Date.now() - startedAt }) },
  );
  const { characterId } = await context.params;
  if (!findConversationCharacter(characterId)) return errorResponse(
    "CHARACTER_UNAVAILABLE",
    404,
    "This character is not available.",
    { "cache-control": "no-store" },
  );
  const databaseStartedAt = Date.now();
  try {
    // Unit/E2E runtimes explicitly inject a static fixture. Every real
    // runtime resolves lifecycle and version from the characters table first.
    const database = process.env.DATABASE_URL ? getDatabase() : null;
    const repository = database ? createDrizzleConversationRepository(database) : null;
    try {
      await resolveConversationCharacter({
        characterKey: characterId,
        characterVersion: 1,
        repository: database && process.env.NODE_ENV !== "test" ? createDrizzleCharacterRepository(database) : undefined,
        allowStaticFallback: isConversationStaticFallbackAllowed(),
      });
    } catch (error) {
      // A user may still open an owned conversation created by an older
      // character version, but it is explicitly read-only. No new route can
      // create or send against that character.
      if (
        error instanceof CharacterRuntimeError
        && error.code === "CHARACTER_UNAVAILABLE"
        && repository
      ) {
        const legacyMessages = await repository.listMessages(user.id, characterId, 1);
        if (legacyMessages.length > 0) {
          const messages = await listConversationHistory(repository, user.id, characterId);
          return NextResponse.json({
            apiVersion: API_VERSION,
            data: {
              characterKey: characterId,
              messages,
              readOnly: true,
              canSend: false,
              contactStatus: "unavailable",
            },
          }, { headers: {
            "cache-control": "no-store",
            "server-timing": serverTiming({ auth: authMs, database: Date.now() - databaseStartedAt, total: Date.now() - startedAt }),
            "x-conversation-persistence": "available",
            "x-conversation-read-only": "true",
          } });
        }
      }
      const status = error instanceof CharacterRuntimeError && error.code === "CHARACTER_RUNTIME_UNAVAILABLE" ? 503 : 404;
      const code = status === 503 ? "CONVERSATION_UNAVAILABLE" : "CHARACTER_UNAVAILABLE";
      return errorResponse(
        code,
        status,
        status === 503
          ? "Conversation history is temporarily unavailable."
          : "This character is not available.",
        { "cache-control": "no-store", "server-timing": serverTiming({ auth: authMs, database: Date.now() - databaseStartedAt, total: Date.now() - startedAt }) },
      );
    }
    if (!repository) {
      return errorResponse(
        "CONVERSATION_UNAVAILABLE",
        503,
        "Conversation history is temporarily unavailable.",
        { "cache-control": "no-store", "server-timing": serverTiming({ auth: authMs, database: Date.now() - databaseStartedAt, total: Date.now() - startedAt }), "x-conversation-persistence": "unavailable" },
      );
    }
    const messages = await listConversationHistory(repository, user.id, characterId);
    const access = await resolveHistoryAccess(database!, user.id, characterId);
    return NextResponse.json({
      apiVersion: API_VERSION,
      data: {
        characterKey: characterId,
        messages,
        ...access,
      },
    }, { headers: {
      "cache-control": "no-store",
      "server-timing": serverTiming({ auth: authMs, database: Date.now() - databaseStartedAt, total: Date.now() - startedAt }),
      "x-conversation-persistence": "available",
    } });
  } catch {
    return errorResponse(
      "CONVERSATION_UNAVAILABLE",
      503,
      "Conversation history is temporarily unavailable.",
      { "cache-control": "no-store", "server-timing": serverTiming({
        auth: authMs,
        database: Date.now() - databaseStartedAt,
        total: Date.now() - startedAt,
      }),
        "x-conversation-persistence": "unavailable",
      },
    );
  }
}
