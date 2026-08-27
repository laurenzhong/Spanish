import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { generatePrivateStory, listPrivateStories } from "@/src/modules/reading/application";
import { generatedStoryRequestSchema } from "@/src/modules/reading/domain/generated-story";
import { createDrizzleGeneratedArticleRepository } from "@/src/modules/reading/repositories";
import { StoryGenerationError, createMiniMaxStoryGenerationProvider } from "@/src/modules/providers/story-generation/server";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string, retryable = status >= 500) {
  return NextResponse.json({ apiVersion: API_VERSION, error: { code, message, requestId, retryable } }, { status });
}

async function currentUser(request: NextRequest) {
  return (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
}

function serializeArticle(article: Awaited<ReturnType<typeof listPrivateStories>>["articles"][number]) {
  return {
    ...article,
    generatedAt: article.generatedAt.toISOString(),
  };
}

function mapError(requestId: string, error: unknown) {
  if (error instanceof StoryGenerationError) {
    if (error.code === "input-invalid" || error.code === "provider-response-invalid") return errorResponse(requestId, "VALIDATION_FAILED", 400, "生成参数或文章格式无效。", false);
    if (error.code === "provider-rate-limited") return errorResponse(requestId, "RATE_LIMITED", 429, "生成服务暂时繁忙，请稍后重试。", true);
    if (error.code === "provider-timeout") return errorResponse(requestId, "PROVIDER_TIMEOUT", 504, "生成超时，请稍后重试。", true);
    if (error.code === "provider-cancelled") return errorResponse(requestId, "PROVIDER_UNAVAILABLE", 499, "生成已取消。", false);
    return errorResponse(requestId, "PROVIDER_UNAVAILABLE", 503, "生成服务暂时不可用。", error.retryable);
  }
  if (error instanceof Error && error.message === "GENERATED_STORY_IDEMPOTENCY_CONFLICT") return errorResponse(requestId, "CONFLICT", 409, "该重试请求的参数与原请求不同。", false);
  if (error instanceof Error && error.message === "GENERATED_STORY_CEFR_MISMATCH") return errorResponse(requestId, "PROVIDER_UNAVAILABLE", 503, "生成结果暂时无法使用，请重试。", true);
  return errorResponse(requestId, "INTERNAL_ERROR", 503, "生成文章暂时无法保存。", true);
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await currentUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.", false);
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "生成文章暂时无法保存。", true);
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return errorResponse(requestId, "VALIDATION_FAILED", 400, "Idempotency-Key 无效。", false);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "生成参数格式无效。", false);
  }
  const parsed = generatedStoryRequestSchema.safeParse(body);
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "生成参数格式无效。", false);
  try {
    const article = await generatePrivateStory(
      createDrizzleGeneratedArticleRepository(getDatabase()),
      createMiniMaxStoryGenerationProvider(),
      user.id,
      parsed.data,
      requestId,
      idempotencyKey,
      request.signal,
    );
    return NextResponse.json({ apiVersion: API_VERSION, data: serializeArticle(article) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return mapError(requestId, error);
  }
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await currentUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.", false);
  if (!process.env.DATABASE_URL) return NextResponse.json({ apiVersion: API_VERSION, data: { articles: [] }, page: { nextCursor: null, hasMore: false }, }, { headers: { "cache-control": "no-store" } });
  try {
    const result = await listPrivateStories(createDrizzleGeneratedArticleRepository(getDatabase()), user.id, { search: request.nextUrl.searchParams.get("search") ?? undefined, cursor: request.nextUrl.searchParams.get("cursor") ?? undefined, pageSize: Number.parseInt(request.nextUrl.searchParams.get("pageSize") ?? "12", 10) || 12 });
    return NextResponse.json({ apiVersion: API_VERSION, data: { articles: result.articles.map(serializeArticle) }, page: { nextCursor: result.nextCursor, hasMore: result.hasMore } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return mapError(requestId, error);
  }
}
