import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  consultConversationAssistant,
  ConversationAssistantError,
} from "@/src/modules/conversation/application/consult-conversation-assistant";
import { isConversationStaticFallbackAllowed } from "@/src/modules/conversation/application/resolve-character-runtime";
import { readConversationAssistantBody } from "@/src/modules/conversation/http/read-conversation-assistant-body";
import { createDrizzleConversationAssistantRepository } from "@/src/modules/conversation/repositories/conversation-assistant-repository";
import { conversationAssistantRequestSchema } from "@/src/modules/conversation/schemas/conversation-assistant";
import { createDrizzleIntroductionRepository, createDrizzleLuciaContactRepository } from "@/src/modules/character-network";
import { ConversationAssistantProviderError } from "@/src/modules/providers/assistant/assistant";
import { createMiniMaxConversationAssistantProvider } from "@/src/modules/providers/assistant/server";
import { createDrizzleProviderCallRepository } from "@/src/modules/providers/repositories/drizzle-provider-call-repository";
import { recordLearningObservation } from "@/src/modules/learning-insights";
import { createDrizzleLearningObservationRepository } from "@/src/modules/learning-insights/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";
import { recordProviderCallSafely } from "@/src/shared/observability";

type RouteContext = Readonly<{ params: Promise<{ characterId: string }> }>;

const invalidRequestMessage = "请输入有效的问题或目标句。";

function failureMessage(code: ApiErrorCode, status: number): string {
  switch (code) {
    case "AUTH_REQUIRED": return "请先登录。";
    case "VALIDATION_FAILED": return invalidRequestMessage;
    case "CONTACT_REQUIRED": return "需要先与该角色建立联系。";
    case "CHARACTER_UNAVAILABLE": return "该角色当前不可用，请刷新后重试。";
    case "RATE_LIMITED": return "请求较频繁，请稍后重试。";
    case "PROVIDER_TIMEOUT": return "AI 助手响应超时，请重试。";
    case "CONVERSATION_UNAVAILABLE": return "暂时无法读取对话上下文，请稍后重试。";
    case "CONTACT_UNAVAILABLE": return "暂时无法确认联系人状态，请稍后重试。";
    case "PROVIDER_UNAVAILABLE": return status === 499 ? "AI 助手请求已取消。" : "AI 助手暂时不可用，请稍后重试。";
    default: return "AI 助手暂时不可用，请稍后重试。";
  }
}

/**
 * Private learning assistance. The route never sends a message: it returns a
 * transient explanation that lives only in the assistant panel's memory.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  const headers = { "cache-control": "private, no-store", "x-request-id": requestId };
  const failure = (code: ApiErrorCode, status: number, message = failureMessage(code, status)) => NextResponse.json({
    apiVersion: API_VERSION,
    error: { code, message, requestId, retryable: status >= 500 || status === 429 },
  }, { status, headers });
  try {
    const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
    if (!user) return failure("AUTH_REQUIRED", 401, "请先登录。");
    let body: unknown;
    try {
      body = await readConversationAssistantBody(request);
    } catch {
      return request.signal.aborted
        ? failure("PROVIDER_UNAVAILABLE", 499, "AI 助手请求已取消。")
        : failure("VALIDATION_FAILED", 400, invalidRequestMessage);
    }
    const parsed = conversationAssistantRequestSchema.safeParse(body);
    if (!parsed.success) return failure("VALIDATION_FAILED", 400, invalidRequestMessage);
    const { characterId } = await context.params;
    const database = process.env.DATABASE_URL ? getDatabase() : undefined;
    const observer = database ? createDrizzleProviderCallRepository(database) : undefined;
    if (database) {
      void recordLearningObservation(
        {
          repository: createDrizzleLearningObservationRepository(database),
          id: () => requestId,
        },
        user.id,
        {
          userId: user.id,
          eventType: "assistant_intent",
          sourceModule: "conversation",
          subjectType: "none",
          subjectId: null,
          subjectVersion: null,
          signalStrength: parsed.data.intent === "grammar" || parsed.data.intent === "structure" ? "moderate" : "weak",
          metadata: { intent: parsed.data.intent },
          dedupeKey: `assistant-intent:${parsed.data.attemptId}`,
          occurredAt: new Date(),
        },
      ).catch(() => undefined);
    }
    const data = await consultConversationAssistant({ ...parsed.data, userId: user.id, characterKey: characterId }, {
      repository: database ? createDrizzleConversationAssistantRepository(database) : undefined,
      allowStaticFallback: isConversationStaticFallbackAllowed(),
      getContactStatus: database ? async (userId, characterKey) => characterKey === "lucia"
        ? (await createDrizzleLuciaContactRepository(database).get(userId)).status
        : await createDrizzleIntroductionRepository(database).getRelationshipStatus?.(userId, characterKey, parsed.data.characterVersion) ?? "unavailable" : undefined,
      provider: createMiniMaxConversationAssistantProvider(),
      signal: request.signal,
      onProviderResult: async (result) => {
        await recordProviderCallSafely(observer, {
          userId: user.id, correlation: { requestId, attemptId: parsed.data.attemptId },
          providerType: "assistant", provider: result.provider, modelVersion: result.modelVersion,
          providerRequestId: result.providerRequestId, status: result.status, latencyMs: result.latencyMs,
          estimatedCostMicros: result.estimatedCostMicros, errorType: result.errorType ?? null,
        });
      },
    });
    return NextResponse.json({ apiVersion: API_VERSION, data }, { headers });
  } catch (error) {
    if (error instanceof ConversationAssistantError) {
      // The application layer only reports the reason; user-facing copy stays here.
      const message = error.code === "VALIDATION_FAILED" && error.reason === "no-target-sentence"
        ? "当前没有可分析的西语句子，请先写一句西语再试。"
        : failureMessage(error.code, error.status);
      return failure(error.code, error.status, message);
    }
    if (error instanceof ConversationAssistantProviderError) {
      if (error.code === "provider-timeout") return failure("PROVIDER_TIMEOUT", 504, "AI 助手响应超时，请重试。");
      if (error.code === "provider-rate-limited") return failure("RATE_LIMITED", 429, "请求较频繁，请稍后重试。");
      if (error.code === "provider-cancelled") return failure("PROVIDER_UNAVAILABLE", 499, "AI 助手请求已取消。");
      return failure("PROVIDER_UNAVAILABLE", 503, "AI 助手暂时不可用，请稍后重试。");
    }
    return failure("CONVERSATION_UNAVAILABLE", 503);
  }
}
