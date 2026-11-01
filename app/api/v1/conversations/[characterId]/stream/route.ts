import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  buildReplyContext,
  encodeConversationEvent,
  CharacterRuntimeError,
  createDrizzleConversationRepository,
  findConversationCharacter,
  isConversationStaticFallbackAllowed,
  prepareReplyGeneration,
  resolveConversationCharacter,
  streamReply,
  type ConversationMessageRecord,
  type StreamReplyInput,
} from "@/src/modules/conversation";
import { conversationStreamRequestSchema } from "@/src/modules/conversation/schemas/conversation-stream-request";
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

  const parsed = conversationStreamRequestSchema.safeParse(body);
  const catalogCharacter = findConversationCharacter(characterId);
  const requestedVersion = body && typeof body === "object" ? (body as Record<string, unknown>).characterVersion : undefined;
  if (catalogCharacter === null || (requestedVersion !== undefined && requestedVersion !== catalogCharacter.version)) {
    return jsonError("CHARACTER_UNAVAILABLE", "This conversation request cannot be started.", 404);
  }
  if (!parsed.success) return jsonError("INPUT_INVALID", "This conversation request cannot be started.", 400);
  const input = parsed.data;
  const { text, clientMessageId, generationId } = input;
  // The catalog owns the current revision. A stale client that names a
  // superseded version is refused instead of being given a second, empty
  // conversation under the old character row.
  const characterVersion = input.characterVersion ?? catalogCharacter.version;

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
  const messageId = randomUUID();
  let conversationId: string | null = null;
  let userMessageId: string | null = null;
  let userMessageIds: readonly string[] = [];
  let claimedUserMessages: readonly ConversationMessageRecord[] = [];
  let recentMessages: readonly Readonly<{ role: "user" | "character"; content: string; sentAt?: string }>[] = (input.pendingMessages ?? []).map((message) => ({ role: "user", content: message.text }));
  if (repository) {
    try {
      const prepared = await prepareReplyGeneration({ repository, userId: user.id, characterKey: characterId, characterVersion, messageId, request: input });
      conversationId = prepared.conversationId;
      userMessageId = prepared.userMessageId;
      userMessageIds = prepared.claim.userMessages.map((message) => message.id);
      claimedUserMessages = prepared.claim.userMessages;
      recentMessages = prepared.recentMessages;
      if (prepared.claim.status === "completed") {
        const stored = prepared.claim.assistant;
        const meta = { type: "meta" as const, protocolVersion: "v1" as const, characterKey: catalogCharacter.key, characterVersion, generationId, messageId: stored.id, createdAt: stored.createdAt.toISOString() };
        return new Response([
          encodeConversationEvent(meta),
          encodeConversationEvent({ type: "delta", generationId, messageId: stored.id, text: stored.content }),
          encodeConversationEvent({ type: "done", generationId, messageId: stored.id }),
        ].join(""), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-conversation-persistence": "available" } });
      }
      if (prepared.claim.status !== "claimed") return jsonError("CONFLICT", "This generation is already running or has been cancelled; retry with a new generation.", 409);
    } catch (error) {
      if (error instanceof Error && error.message === "MESSAGE_CONFLICT") return jsonError("CONFLICT", "A retry must preserve every message and assistance declaration.", 409);
      return jsonError("CONVERSATION_UNAVAILABLE", "The conversation could not be saved.", 503);
    }
  }
  let replyContext;
  try {
    replyContext = await buildReplyContext({
      generationId,
      userId: user.id,
      userMessage: text.trim(),
      unansweredUserMessages: [...(input.pendingMessages ?? []).map((message) => message.text), text],
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
      unansweredUserMessages: [...(input.pendingMessages ?? []).map((message) => message.text), text],
      character: runtimeCharacter.catalog.snapshot,
      recentMessages,
      relationshipStage,
      relationshipSummary: luciaContact?.relationshipSummary,
      now: new Date(),
    });
  }
  const configuredProvider = process.env.CONVERSATION_PROVIDER?.trim().toLowerCase() || "deepseek";
  const useDeepSeek = configuredProvider === "deepseek" && Boolean(process.env.OPENAI_API_KEY?.trim());
  const useOpenAI = configuredProvider === "openai" && Boolean(process.env.OPENAI_API_KEY?.trim());
  const useMiniMax = !useDeepSeek && !useOpenAI && Boolean(process.env.MINIMAX_API_KEY?.trim());
  const replyProvider = useDeepSeek || useOpenAI
    ? createOpenAIConversationProvider({ providerName: useDeepSeek ? "deepseek" : "openai" })
    : useMiniMax
      ? createMiniMaxConversationProvider()
      : undefined;
  if (!replyProvider && !isConversationStaticFallbackAllowed()) {
    if (repository?.cancelReplyGeneration && conversationId) await repository.cancelReplyGeneration({ userId: user.id, conversationId, generationId });
    return jsonError("CONVERSATION_UNAVAILABLE", "A conversation provider is not configured.", 503);
  }
  const transportAbort = new AbortController();
  const forwardAbort = () => transportAbort.abort();
  request.signal.addEventListener("abort", forwardAbort, { once: true });
  if (request.signal.aborted) transportAbort.abort();
  const replyInput: StreamReplyInput = {
    characterKey: characterId,
    characterVersion,
    text,
    clientMessageId,
    generationId,
    messageId,
    replyContext,
    replyProvider,
    providerName: useDeepSeek ? "deepseek" : useOpenAI ? "openai" : useMiniMax ? "minimax" : "deterministic-fake",
    providerModelVersion: useDeepSeek || useOpenAI
      ? (process.env.OPENAI_CONVERSATION_MODEL?.trim() || "gpt-5.6sol")
      : "MiniMax-M3",
    signal: transportAbort.signal,
  };
  const correlation = createCorrelationIds({ requestId, generationId });
  const streamStartedAt = Date.now();
  const iterator = streamReply({
    ...replyInput,
    onBubble: async ({ prefix }) => {
      if (transportAbort.signal.aborted) return false;
      if (!repository || !conversationId) return true;
      const saved = await repository.saveReplyPrefix?.({ userId: user.id, conversationId, generationId, prefix, userMessageIds });
      if (!saved) transportAbort.abort();
      return Boolean(saved) && !transportAbort.signal.aborted;
    },
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
  let readerCancelled = false;
  let completed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      try {
        for await (const event of iterator) {
          if (readerCancelled) break;
          if (event.type === "delta") assistantText += event.text;
          if (event.type === "done" && repository && conversationId && userMessageId) {
            const assistantMessage = transportAbort.signal.aborted ? null : await repository.finishReplyGeneration?.({ userId: user.id, conversationId, generationId, content: assistantText, userMessageIds });
            if (!assistantMessage) {
              controller.enqueue(encoder.encode(encodeConversationEvent({ type: "error", generationId, messageId, code: "stream-aborted", retryable: true })));
              break;
            }
            completed = true;
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
              try {
                const memorySources: ConversationMessageRecord[] = [];
                for (const source of claimedUserMessages) {
                  if (source.status === "completed" && !(await repository.isMessageWithdrawn?.(user.id, source.id))) memorySources.push(source);
                }
                const candidates = memorySources.flatMap((source) => extractMemories({
                  userId: user.id,
                  characterKey: characterId,
                  characterVersion,
                  conversationId,
                  turn: {
                    status: "done",
                    userMessage: {
                      id: source.id,
                      role: "user",
                      status: "completed",
                      content: source.content,
                    },
                    assistantMessage: {
                      id: assistantMessage.id,
                      role: "character",
                      status: "completed",
                      content: assistantMessage.content,
                    },
                  },
                }));
                if (candidates.length > 0) {
                  await commitMemories({
                    repository: memoryRepository,
                    completed: true,
                    candidates,
                    diagnostics,
                    requestId,
                  });
                }
              } catch {
                // Source checks and extraction are best-effort after completion; never log private payloads.
              }
            }
          }
          if (!readerCancelled) controller.enqueue(encoder.encode(encodeConversationEvent(event)));
        }
        if (!readerCancelled) controller.close();
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
          errorType: transportAbort.signal.aborted ? "provider-cancelled" : "stream-failed",
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
          status: transportAbort.signal.aborted ? "cancelled" : "failed",
          latencyMs: Date.now() - streamStartedAt,
          errorType: transportAbort.signal.aborted ? "provider-cancelled" : "stream-failed",
        });
        if (!readerCancelled) controller.enqueue(
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
        if (!readerCancelled) controller.close();
      } finally {
        request.signal.removeEventListener("abort", forwardAbort);
        if (!completed && repository?.cancelReplyGeneration && conversationId) {
          try { await repository.cancelReplyGeneration({ userId: user.id, conversationId, generationId }); } catch { /* Retain durable prefixes; no private payload logging. */ }
        }
      }
    },
    async cancel() {
      readerCancelled = true;
      transportAbort.abort();
      request.signal.removeEventListener("abort", forwardAbort);
      if (repository?.cancelReplyGeneration && conversationId) await repository.cancelReplyGeneration({ userId: user.id, conversationId, generationId });
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
