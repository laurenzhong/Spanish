import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  encodeConversationEvent,
  createDrizzleConversationRepository,
  persistCompletedAssistantMessage,
  persistUserMessage,
  streamReply,
  type StreamReplyInput,
} from "@/src/modules/conversation";
import {
  commitMemories,
  createDrizzleMemoryRepository,
  extractMemories,
} from "@/src/modules/memory";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ characterId: string }> }>;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { code, message, retryable: status >= 500 } },
    { status },
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  // Web sends the Supabase session cookie; Flutter sends a bearer token.
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return jsonError("AUTH_REQUIRED", "A valid user session is required.", 401);

  const { characterId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("INPUT_INVALID", "The conversation request is not valid JSON.", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError("INPUT_INVALID", "The conversation request is invalid.", 400);
  }
  const input = body as Record<string, unknown>;
  const text = typeof input.text === "string" ? input.text : "";
  const characterVersion = input.characterVersion === undefined ? 1 : input.characterVersion;
  const clientMessageId = typeof input.clientMessageId === "string" ? input.clientMessageId : "";
  const generationId = typeof input.generationId === "string" ? input.generationId : "";
  if (
    characterId !== "lucia" ||
    characterVersion !== 1 ||
    !text.trim() ||
    text.length > 2_000 ||
    !clientMessageId.trim() ||
    !generationId.trim()
  ) {
    return jsonError(
      characterId !== "lucia" || characterVersion !== 1
        ? "CHARACTER_UNAVAILABLE"
        : "INPUT_INVALID",
      "This conversation request cannot be started.",
      characterId !== "lucia" || characterVersion !== 1 ? 404 : 400,
    );
  }

  const replyInput: StreamReplyInput = {
    characterKey: characterId,
    characterVersion: 1,
    text,
    clientMessageId,
    generationId,
    messageId: randomUUID(),
    signal: request.signal,
  };
  const repository = process.env.DATABASE_URL
    ? createDrizzleConversationRepository(getDatabase())
    : null;
  const memoryRepository = process.env.DATABASE_URL
    ? createDrizzleMemoryRepository(getDatabase())
    : null;
  let conversationId: string | null = null;
  let userMessageId: string | null = null;
  if (repository) {
    try {
      conversationId = await repository.getOrCreateConversation(user.id, characterId, 1);
      const userMessage = await persistUserMessage(repository, {
        userId: user.id,
        conversationId,
        characterKey: characterId,
        clientMessageId,
        generationId,
        content: text.trim(),
      });
      // reply_to_message_id is a database UUID, not the client-generated id.
      userMessageId = userMessage.id;
    } catch {
      return jsonError("CONVERSATION_UNAVAILABLE", "The conversation could not be saved.", 503);
    }
  }
  const iterator = streamReply(replyInput);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      try {
        for await (const event of iterator) {
          if (event.type === "delta") assistantText += event.text;
          if (event.type === "done" && repository && conversationId && userMessageId) {
            const assistantMessage = await persistCompletedAssistantMessage(repository, {
              userId: user.id,
              conversationId,
              characterKey: characterId,
              messageId: event.messageId,
              generationId,
              clientMessageId: `assistant-${generationId}`,
              content: assistantText,
              replyToMessageId: userMessageId,
            });
            if (memoryRepository) {
              const candidates = extractMemories({
                userId: user.id,
                characterKey: characterId,
                characterVersion: 1,
                conversationId,
                turn: {
                  status: "done",
                  userMessage: {
                    id: userMessageId,
                    role: "user",
                    status: "completed",
                    content: text.trim(),
                  },
                  assistantMessage: {
                    id: assistantMessage.id,
                    role: "character",
                    status: "completed",
                    content: assistantMessage.content,
                  },
                },
              });
              if (candidates.length > 0) {
                // Memory extraction is best-effort after the durable message write.
                // A memory failure must not turn a completed chat reply into a failed one.
                try {
                  await commitMemories({ repository: memoryRepository, completed: true, candidates });
                } catch {
                  // Do not log candidate text or private conversation content.
                }
              }
            }
          }
          controller.enqueue(encoder.encode(encodeConversationEvent(event)));
        }
        controller.close();
      } catch {
        controller.enqueue(
          encoder.encode(
            encodeConversationEvent({
              type: "error",
              generationId,
              messageId: null,
              code: "stream-failed",
              retryable: true,
            }),
          ),
        );
        controller.close();
      }
    },
    cancel() {
      // The request signal is owned by Next; streamReply observes it between chunks.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      connection: "keep-alive",
      "x-conversation-persistence": repository ? "available" : "unavailable",
    },
  });
}
