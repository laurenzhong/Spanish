import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { listSavedArticles, setSavedArticle } from "@/src/modules/reading";
import { createDrizzleReadingRepository } from "@/src/modules/reading/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const saveInputSchema = z.object({ articleId: z.string().trim().min(3).max(240), saved: z.boolean().default(true) });

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 } },
    { status },
  );
}

async function persistSave(requestId: string, userId: string, articleId: string, saved: boolean) {
  try {
    const result = await setSavedArticle(createDrizzleReadingRepository(getDatabase()), userId, articleId, saved);
    return NextResponse.json(
      { apiVersion: API_VERSION, data: { articleId, saved: result } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "ARTICLE_NOT_FOUND") {
      return errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "文章版本不存在或尚未发布。");
    }
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "已保存文章暂时无法更新。");
  }
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "已保存文章暂时无法读取。");
  try {
    const articleIds = await listSavedArticles(createDrizzleReadingRepository(getDatabase()), user.id);
    return NextResponse.json({ apiVersion: API_VERSION, data: { articleIds } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "已保存文章暂时无法读取。");
  }
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "已保存文章暂时无法更新。");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "保存文章格式无效。");
  }
  const parsed = saveInputSchema.safeParse(body);
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "保存文章格式无效。");
  return persistSave(requestId, user.id, parsed.data.articleId, parsed.data.saved);
}

export async function DELETE(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "已保存文章暂时无法更新。");
  const parsed = saveInputSchema.safeParse({ articleId: request.nextUrl.searchParams.get("articleId"), saved: false });
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "保存文章格式无效。");
  return persistSave(requestId, user.id, parsed.data.articleId, false);
}
