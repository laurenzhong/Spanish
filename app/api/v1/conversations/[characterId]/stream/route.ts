import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  buildReplyContext,
  encodeConversationEvent,
  CharacterRuntimeError,
  createDrizzleConversationRepository,
  findConversationCharacter,
  isConversationStaticFallbackAllowed,
  persistCompletedAssistantMessage,
  persistUserMessage,
  resolveConversationCharacter,
  streamReply,
  type StreamReplyInput,
} from "@/src/modules/conversation";
import { createDrizzleCharacterRepository } from "@/src/modules/characters";
import {
  commitMemories,
  createDrizzleMemoryRepository,
  extractMemories,
} from "@/src/modules/memory";
import {
  createDrizzleIntroductionRepository,
  createDrizzleLuciaContactRepository,
  proposeIntroduction,
  type LuciaContactRecord,
} from "@/src/modules/character-network";
import { createMiniMaxConversationProvider, createOpenAIConversationProvider } from "@/src/modules/providers/conversation/server";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
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
    { apiVersion: API_VERSION, error: { code, message, retryable: status >= 500 } },
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
  // An invalid explicit bearer must not fall back to the cookie session.
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
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
  // The catalog owns the current revision. A stale client that names a
  // superseded version is refused instead of being given a second, empty
  // conversation under the old character row.
  const catalogCharacter = findConversationCharacter(characterId);
  const characterVersion = input.characterVersion === undefined
    ? catalogCharacter?.version ?? 1
    : input.characterVersion;
  const characterUnavailable = catalogCharacter === null || characterVersion !== catalogCharacter.version;
  const clientMessageId = typeof input.clientMessageId === "string" ? input.clientMessageId : "";
  const generationId = typeof input.generationId === "string" ? input.generationId : "";
  if (
    characterUnavailable ||
    !text.trim() ||
    text.length > 2_000 ||
    !clientMessageId.trim() ||
    !generationId.trim()
  ) {
    return jsonError(
      characterUnavailable ? "CHARACTER_UNAVAILABLE" : "INPUT_INVALID",
      "This conversation request cannot be started.",
      characterUnavailable ? 404 : 400,
    );
  }

  let database: ReturnType<typeof getDatabase> | null = null;
  try {
    database = process.env.DATABASE_URL ? getDatabase() : null;
  } catch {
    return jsonError("CONVERSATION_UNAVAILABLE", "Conversation persistence is unavailable.", 503);
  }
  let runtimeCharacter: Awaited<ReturnType<typeof resolveConversationCharacter>>;
  try {
    runtimeCharacter = await resolveConversationCharacter({
      characterKey: characterId,
      characterVersion,
      repository: database && process.env.NODE_ENV !== "test" ? createDrizzleCharacterRepository(database) : undefined,
      allowStaticFallback: isConversationStaticFallbackAllowed(),
    });
  } catch (error) {
    const unavailable = error instanceof CharacterRuntimeError && error.code === "CHARACTER_UNAVAILABLE";
    return jsonError(
      unavailable ? "CHARACTER_UNAVAILABLE" : "CONVERSATION_UNAVAILABLE",
      unavailable ? "This character is not available for new conversations." : "Conversation runtime is unavailable.",
      unavailable ? 404 : 503,
    );
  }
  let luciaContact: LuciaContactRecord | null = null;
  let relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend" | undefined;
  if (database && characterId === "lucia") {
    try {
      luciaContact = await createDrizzleLuciaContactRepository(database).get(user.id);
      if (luciaContact.status !== "active") {
        return jsonError("CONTACT_REQUIRED", "Accept Lucia's friend request before starting this conversation.", 403);
      }
      relationshipStage = luciaContact.relationshipStage;
    } catch {
      return jsonError("CONTACT_UNAVAILABLE", "Lucia's contact status is temporarily unavailable.", 503);
    }
  }
  if (database && characterId !== "lucia") {
    try {
      const status = await createDrizzleIntroductionRepository(database).getRelationshipStatus?.(user.id, characterId, 1);
      if (status !== "active") {
        return jsonError("CONTACT_REQUIRED", "Accept this character's introduction before starting the conversation.", 403);
      }
    } catch {
      return jsonError("CONTACT_UNAVAILABLE", "This character's contact status is temporarily unavailable.", 503);
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
      const history = await repository.listMessages(user.id, characterId, 100);
      const withdrawnIds = new Set(history.filter((message) => message.status === "withdrawn").map((message) => message.id));
      recentMessages = history
        .filter((message) => message.status !== "withdrawn" && !(message.role === "character" && message.replyToMessageId && withdrawnIds.has(message.replyToMessageId)))
        .map((message) => ({ role: message.role, content: message.content, sentAt: message.createdAt.toISOString() }));
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
      character: runtimeCharacter.catalog.snapshot,
      recentMessages,
      relationshipStage,
      relationshipSummary: luciaContact?.relationshipSummary,
      now: new Date(),
      memoryRepository: readableMemoryRepository,
    });
  } catch {
    // A memory read failure must not block a natural reply; continue without memory context.
    replyContext = await buildReplyContext({
      generationId,
      userId: user.id,
      userMessage: text.trim(),
      character: runtimeCharacter.catalog.snapshot,
      recentMessages,
      relationshipStage,
      relationshipSummary: luciaContact?.relationshipSummary,
      now: new Date(),
    });
  }
  const configuredProvider = process.env.CONVERSATION_PROVIDER?.trim().toLowerCase();
  const useOpenAI = configuredProvider === "openai" && Boolean(process.env.OPENAI_API_KEY?.trim());
  const useMiniMax = !useOpenAI && Boolean(process.env.MINIMAX_API_KEY?.trim());
  const replyProvider = useOpenAI
    ? createOpenAIConversationProvider()
    : useMiniMax
      ? createMiniMaxConversationProvider()
      : undefined;
  if (!replyProvider && !isConversationStaticFallbackAllowed()) {
    return jsonError("CONVERSATION_UNAVAILABLE", "A conversation provider is not configured.", 503);
  }
  const replyInput: StreamReplyInput = {
    characterKey: characterId,
    characterVersion,
    text,
    clientMessageId,
    generationId,
    messageId: randomUUID(),
    replyContext,
    replyProvider,
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
      conversationId = await repository.getOrCreateConversation(user.id, characterId, characterVersion);
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
                characterVersion,
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
