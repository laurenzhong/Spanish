import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  buildReplyContext,
  encodeConversationEvent,
  createDrizzleConversationRepository,
  findConversationCharacter,
  getConversationCharacter,
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
import {
  createDrizzleIntroductionRepository,
  createDrizzleLuciaContactRepository,
  proposeIntroduction,
} from "@/src/modules/character-network";
import { createMiniMaxConversationProvider, createOpenAIConversationProvider } from "@/src/modules/providers/conversation/server";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import {
  createCorrelationIds,
  recordDiagnosticEventSafely,
  recordProviderCallSafely,
} from "@/src/shared/observability";
import { createDrizzleProviderCallRepository } from "@/src/modules/providers/repositories/drizzle-provider-call-repository";
import { createDrizzleDiagnosticEventRepository } from "@/src/modules/observability";

type RouteContext = Readonly<{ params: Promise<{ characterId: string }> }>;

function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: { code, message, retryable: status >= 500 } },
    { status },
  );
}

export async function POST(request: NextRequest, context: RouteContext) {
  const suppliedRequestId = request.headers.get("x-request-id");
  let requestId: string;
  try {
    requestId = createCorrelationIds({ requestId: suppliedRequestId ?? undefined }).requestId;
  } catch {
    requestId = createCorrelationIds().requestId;
  }
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
    !findConversationCharacter(characterId) ||
    characterVersion !== 1 ||
    !text.trim() ||
    text.length > 2_000 ||
    !clientMessageId.trim() ||
    !generationId.trim()
  ) {
    return jsonError(
      !findConversationCharacter(characterId) || characterVersion !== 1
        ? "CHARACTER_UNAVAILABLE"
        : "INPUT_INVALID",
      "This conversation request cannot be started.",
      !findConversationCharacter(characterId) || characterVersion !== 1 ? 404 : 400,
    );
  }

  const database = process.env.DATABASE_URL ? getDatabase() : null;
  if (database && characterId === "lucia") {
    try {
      const contact = await createDrizzleLuciaContactRepository(database).get(user.id);
      if (contact.status !== "active") {
        return jsonError("CONTACT_REQUIRED", "Accept Lucia's friend request before starting this conversation.", 403);
      }
    } catch {
      return jsonError("CONTACT_UNAVAILABLE", "Lucia's contact status is temporarily unavailable.", 503);
    }
  }
  const repository = database ? createDrizzleConversationRepository(database) : null;
  const memoryRepository = database ? createDrizzleMemoryRepository(database) : null;
  const providerCallObserver = database
    ? createDrizzleProviderCallRepository(database)
    : undefined;
  const diagnostics = database ? createDrizzleDiagnosticEventRepository(database) : undefined;
  const readableMemoryRepository = memoryRepository && typeof memoryRepository.listReadableMemories === "function"
    ? memoryRepository
    : undefined;
  let recentMessages: readonly Readonly<{ role: "user" | "character"; content: string }>[] = [];
  if (repository) {
    try {
      const history = await repository.listMessages(user.id, characterId, 20);
      const withdrawnIds = new Set(history.filter((message) => message.status === "withdrawn").map((message) => message.id));
      recentMessages = history
        .filter((message) => message.status !== "withdrawn" && !(message.role === "character" && message.replyToMessageId && withdrawnIds.has(message.replyToMessageId)))
        .map((message) => ({ role: message.role, content: message.content }));
    } catch {
      // Conversation history is helpful context, but a read failure must not block a reply.
    }
  }
  let replyContext;
  try {
    replyContext = await buildReplyContext({
      generationId,
      userId: user.id,
      userMessage: text.trim(),
      character: getConversationCharacter(characterId).snapshot,
      recentMessages,
      memoryRepository: readableMemoryRepository,
    });
  } catch {
    // A memory read failure must not block a natural reply; continue without memory context.
    replyContext = await buildReplyContext({
      generationId,
      userId: user.id,
      userMessage: text.trim(),
      character: getConversationCharacter(characterId).snapshot,
      recentMessages,
    });
  }
  const configuredProvider = process.env.CONVERSATION_PROVIDER?.trim().toLowerCase();
  const useOpenAI = configuredProvider === "openai" && Boolean(process.env.OPENAI_API_KEY?.trim());
  const useMiniMax = !useOpenAI && Boolean(process.env.MINIMAX_API_KEY?.trim());
  const replyInput: StreamReplyInput = {
    characterKey: characterId,
    characterVersion: 1,
    text,
    clientMessageId,
    generationId,
    messageId: randomUUID(),
    replyContext,
    replyProvider: useOpenAI
      ? createOpenAIConversationProvider()
      : useMiniMax
        ? createMiniMaxConversationProvider()
        : undefined,
    providerName: useOpenAI ? "openai" : useMiniMax ? "minimax" : "deterministic-fake",
    providerModelVersion: useOpenAI
      ? (process.env.OPENAI_CONVERSATION_MODEL?.trim() || "gpt-5.6sol")
      : "MiniMax-M3",
    signal: request.signal,
  };
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
  const correlation = createCorrelationIds({ requestId, generationId });
  const streamStartedAt = Date.now();
  const iterator = streamReply({
    ...replyInput,
    onProviderResult: async (observation) => {
      await recordProviderCallSafely(providerCallObserver, {
        userId: user.id,
        correlation: createCorrelationIds({
          requestId,
          conversationId: conversationId ?? undefined,
          generationId,
        }),
        providerType: "conversation",
        provider: observation.provider,
        modelVersion: observation.modelVersion,
        providerRequestId: observation.providerRequestId,
        status: observation.status,
        latencyMs: observation.latencyMs,
        estimatedCostMicros: observation.estimatedCostMicros,
        errorType: observation.errorType ?? null,
      });
    },
  });
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
            const userMessageWithdrawn = repository.isMessageWithdrawn
              ? await repository.isMessageWithdrawn(user.id, userMessageId)
              : false;
            if (userMessageWithdrawn) {
              controller.enqueue(encoder.encode(encodeConversationEvent(event)));
              continue;
            }
            // Introduction offers are derived only from a durable, completed Lucía turn.
            // A failed character import or offer write must not change chat success.
            if (characterId === "lucia") {
              try {
              const normalizedText = text
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/gu, "")
                .toLocaleLowerCase("es-ES");
              const targetCharacterKey = /\b(?:trabajo|universidad|estudio|mudanza|familia|casa|alquiler|vecino|barrio|rutina)\b/iu.test(normalizedText)
                ? "ines"
                : "mateo";
              await proposeIntroduction({
                repository: createDrizzleIntroductionRepository(database ?? getDatabase()),
                candidate: {
                  userId: user.id,
                  sourceCharacterKey: "lucia",
                  sourceCharacterVersion: 1,
                  targetCharacterKey,
                  targetCharacterVersion: 1,
                  recentMessages: [{ role: "user", content: text.trim() }],
                },
              });
              } catch {
                // Offers are best-effort and never turn a completed reply into a failure.
              }
            }
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
                  await commitMemories({
                    repository: memoryRepository,
                    completed: true,
                    candidates,
                    diagnostics,
                    requestId,
                  });
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
        await recordDiagnosticEventSafely(diagnostics, {
          userId: user.id,
          eventType: "conversation.stream_failed",
          severity: "alert",
          dedupeKey: `conversation-stream-failed:${user.id}:${generationId}`,
          correlation: {
            requestId,
            conversationId: conversationId ?? undefined,
            generationId,
          },
          errorType: request.signal.aborted ? "provider-cancelled" : "stream-failed",
        });
        await recordProviderCallSafely(providerCallObserver, {
          userId: user.id,
          correlation: createCorrelationIds({
            ...correlation,
            conversationId: conversationId ?? undefined,
          }),
          providerType: "conversation",
          provider: "conversation-stream",
          modelVersion: "protocol-v1",
          status: request.signal.aborted ? "cancelled" : "failed",
          latencyMs: Date.now() - streamStartedAt,
          errorType: request.signal.aborted ? "provider-cancelled" : "stream-failed",
        });
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
      "x-request-id": requestId,
    },
  });
}
