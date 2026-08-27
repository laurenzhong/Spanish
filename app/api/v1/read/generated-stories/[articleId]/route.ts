import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { deletePrivateStory, getPrivateStory } from "@/src/modules/reading/application";
import { createDrizzleGeneratedArticleRepository } from "@/src/modules/reading/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ articleId: string }> }>;

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string, retryable = status >= 500) {
  return NextResponse.json({ apiVersion: API_VERSION, error: { code, message, requestId, retryable } }, { status });
}

async function currentUser(request: NextRequest) {
  return (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
}

function serializeArticle(article: NonNullable<Awaited<ReturnType<typeof getPrivateStory>>>) {
  return { ...article, generatedAt: article.generatedAt.toISOString() };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await currentUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.", false);
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "这篇文章暂时无法阅读。", false);
  const { articleId } = await params;
  try {
    const article = await getPrivateStory(createDrizzleGeneratedArticleRepository(getDatabase()), user.id, decodeURIComponent(articleId));
    return article ? NextResponse.json({ apiVersion: API_VERSION, data: serializeArticle(article) }, { headers: { "cache-control": "no-store" } }) : errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "这篇文章暂时无法阅读。", false);
  } catch {
    return errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "这篇文章暂时无法阅读。", false);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await currentUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.", false);
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "这篇文章不存在。", false);
  const { articleId } = await params;
  try {
    const deleted = await deletePrivateStory(createDrizzleGeneratedArticleRepository(getDatabase()), user.id, decodeURIComponent(articleId));
    return deleted ? NextResponse.json({ apiVersion: API_VERSION, data: { deleted: true } }, { headers: { "cache-control": "no-store" } }) : errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "这篇文章不存在。", false);
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "文章暂时无法删除。", true);
  }
}
