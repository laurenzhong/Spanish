import { NextRequest, NextResponse } from "next/server";

import {
  CharacterRuntimeError,
  createDrizzleConversationRepository,
  isConversationStaticFallbackAllowed,
  listConversationHistory,
  resolveConversationCharacter,
  resolveHistoryAccess,
  findConversationCharacter,
  type ConversationHistoryAccess,
  type ConversationMessage,
} from "@/src/modules/conversation";
import { createDrizzleCharacterRepository } from "@/src/modules/characters";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ characterId: string }> }>;

type Settled<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: unknown }>;

/**
 * Runs one branch of a parallel read without letting its rejection decide the
 * outcome of the other branches. The branches below are independent, so each
 * one reports its own result to the existing per-branch error handling.
 */
async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

const UNREADABLE_HISTORY_ACCESS: ConversationHistoryAccess = {
  readOnly: true,
  canSend: false,
  contactStatus: "unavailable",
};

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

    // Opening a conversation needs three independent reads: the character
    // runtime (character + canon facts), the message history, and the contact
    // gate (character + relationship + conversation). Issued one after another
    // they cost six round trips, and a remote database bills the request in
    // round trips rather than query cost - the SQL itself executes in
    // single-digit milliseconds. Issuing them together costs the longest
    // branch instead of their sum.
    const [character, history, access] = await Promise.all([
      settle(resolveConversationCharacter({
        characterKey: characterId,
        characterVersion: 1,
        repository: database && process.env.NODE_ENV !== "test" ? createDrizzleCharacterRepository(database) : undefined,
        allowStaticFallback: isConversationStaticFallbackAllowed(),
      })),
      settle<readonly ConversationMessage[] | null>(
        repository ? listConversationHistory(repository, user.id, characterId) : Promise.resolve(null),
      ),
      database ? resolveHistoryAccess(database, user.id, characterId) : Promise.resolve(UNREADABLE_HISTORY_ACCESS),
    ]);

    if (!character.ok) {
      const error = character.error;
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
    // The history read already ran alongside the character gate above. A
    // failure here is the same persistence failure as before: the outer catch
    // reports it as CONVERSATION_UNAVAILABLE.
    if (!history.ok) throw history.error;
    const messages = history.value ?? [];
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
