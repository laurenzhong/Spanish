import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { assistExpression, ExpressionAssistError } from "@/src/modules/conversation/application/assist-expression";
import { expressionAssistAttempts } from "@/src/modules/conversation/application/expression-assist-attempts";
import { isConversationStaticFallbackAllowed } from "@/src/modules/conversation/application/resolve-character-runtime";
import { createDrizzleExpressionAssistRepository } from "@/src/modules/conversation/repositories/expression-assist-repository";
import { readExpressionAssistBody } from "@/src/modules/conversation/http/read-expression-assist-body";
import { expressionAssistRequestSchema } from "@/src/modules/conversation/schemas/expression-assist";
import { createDrizzleIntroductionRepository, createDrizzleLuciaContactRepository } from "@/src/modules/character-network";
import { createMiniMaxTranslationProvider } from "@/src/modules/providers/translation/server";
import { TranslationError } from "@/src/modules/providers/translation/translation";
import { createDrizzleProviderCallRepository } from "@/src/modules/providers/repositories/drizzle-provider-call-repository";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";
import { recordProviderCallSafely } from "@/src/shared/observability";

type RouteContext = Readonly<{ params: Promise<{ characterId: string }> }>;

export async function POST(request: NextRequest, context: RouteContext) {
  const requestId = randomUUID();
  const headers = { "cache-control": "private, no-store", "x-request-id": requestId };
  const failure = (code: ApiErrorCode, status: number, message = "暂时无法生成表达，请稍后重试。") => NextResponse.json({
    apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 || status === 429 },
  }, { status, headers });
  try {
    const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
    if (!user) return failure("AUTH_REQUIRED", 401, "请先登录。");
    let body: unknown;
    try { body = await readExpressionAssistBody(request); }
    catch { return request.signal.aborted ? failure("PROVIDER_UNAVAILABLE", 499, "表达生成已取消。") : failure("VALIDATION_FAILED", 400, "请输入有效的中文或中西语草稿。"); }
    const parsed = expressionAssistRequestSchema.safeParse(body);
    if (!parsed.success) return failure("VALIDATION_FAILED", 400, "请输入有效的中文或中西语草稿。");
    const { characterId } = await context.params;
    const database = process.env.DATABASE_URL ? getDatabase() : undefined;
    const observer = database ? createDrizzleProviderCallRepository(database) : undefined;
    const data = await assistExpression({ ...parsed.data, userId: user.id, characterKey: characterId }, {
      repository: database ? createDrizzleExpressionAssistRepository(database) : undefined,
      allowStaticFallback: isConversationStaticFallbackAllowed(),
      getContactStatus: database ? async (userId, characterKey) => characterKey === "lucia"
        ? (await createDrizzleLuciaContactRepository(database).get(userId)).status
        : await createDrizzleIntroductionRepository(database).getRelationshipStatus?.(userId, characterKey, parsed.data.characterVersion) ?? "unavailable" : undefined,
      provider: createMiniMaxTranslationProvider(), signal: request.signal,
      attempts: expressionAssistAttempts,
      onProviderResult: async (result) => {
        await recordProviderCallSafely(observer, {
          userId: user.id, correlation: { requestId, attemptId: parsed.data.attemptId },
          providerType: "translation", provider: result.provider, modelVersion: result.modelVersion,
          providerRequestId: result.providerRequestId, status: result.status, latencyMs: result.latencyMs,
          estimatedCostMicros: result.estimatedCostMicros, errorType: result.errorType ?? null,
        });
      },
    });
    return NextResponse.json({ apiVersion: API_VERSION, data }, { headers });
  } catch (error) {
    if (error instanceof ExpressionAssistError) return failure(error.code, error.status);
    if (error instanceof TranslationError) {
      if (error.code === "provider-timeout") return failure("PROVIDER_TIMEOUT", 504, "表达生成超时，请重试。");
      if (error.code === "provider-rate-limited") return failure("RATE_LIMITED", 429, "请求较频繁，请稍后重试。");
      if (error.code === "provider-cancelled") return failure("PROVIDER_UNAVAILABLE", 499, "表达生成已取消。");
      return failure("PROVIDER_UNAVAILABLE", 503);
    }
    return failure("CONVERSATION_UNAVAILABLE", 503);
  }
}
