import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getReadingState, saveReadingState } from "@/src/modules/reading";
import { readingStatePatchSchema } from "@/src/modules/reading/domain/reading-state";
import { createDrizzleReadingRepository } from "@/src/modules/reading/repositories";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ articleId: string }> }>;

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 } },
    { status },
  );
}

function serializeState(state: Awaited<ReturnType<typeof getReadingState>>) {
  if (!state) return null;
  return {
    ...state,
    lastOpenedAt: state.lastOpenedAt.toISOString(),
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "阅读状态暂时无法同步。");
  try {
    const { articleId } = await context.params;
    const state = await getReadingState(createDrizzleReadingRepository(getDatabase()), user.id, decodeURIComponent(articleId));
    return NextResponse.json(
      { apiVersion: API_VERSION, data: { state: serializeState(state) } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "阅读状态暂时无法同步。");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "阅读状态暂时无法同步。");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "阅读状态格式无效。");
  }
  const parsed = readingStatePatchSchema.safeParse(body);
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "阅读状态格式无效。");
  try {
    const { articleId } = await context.params;
    const state = await saveReadingState(createDrizzleReadingRepository(getDatabase()), user.id, decodeURIComponent(articleId), parsed.data);
    return NextResponse.json(
      { apiVersion: API_VERSION, data: { state: serializeState(state) } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "ARTICLE_NOT_FOUND") return errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "文章版本不存在或尚未发布。");
    if (error instanceof Error && error.message === "ARTICLE_VERSION_CONFLICT") return errorResponse(requestId, "CONFLICT", 409, "文章版本已更新，请重新定位阅读标注。");
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "阅读状态暂时无法同步。");
  }
}
