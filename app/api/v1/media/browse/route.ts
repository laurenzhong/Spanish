import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { browseMedia, createDrizzleMediaRepository, mediaBrowseQuerySchema } from "@/src/modules/media";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const error = (code: string, message: string, status: number, retryable = false) => NextResponse.json({
    apiVersion: API_VERSION, error: { code, message, retryable, requestId },
  }, { status, headers: { "cache-control": "private, no-store" } });
  try {
    const user = request.headers.has("authorization")
      ? await verifyRequestUser(request)
      : await getCurrentUser();
    if (!user) return error("AUTH_REQUIRED", "请先登录。", 401);
    // Bound the read-only request, including the recent-display exclusions.
    const body = await request.text();
    if (body.length > 220_000) return error("VALIDATION_FAILED", "浏览参数过长。", 400);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return error("VALIDATION_FAILED", "浏览参数无效。", 400); }
    const parsed = mediaBrowseQuerySchema.safeParse(raw);
    if (!parsed.success) return error("VALIDATION_FAILED", "浏览参数无效。", 400);
    if (!process.env.DATABASE_URL) return error("MEDIA_NOT_AVAILABLE", "媒体资料库暂时不可用。", 503, true);
    const result = await browseMedia(createDrizzleMediaRepository(getDatabase()), parsed.data, user.id);
    return NextResponse.json({ apiVersion: API_VERSION, data: { items: result.items }, page: { nextCursor: result.nextCursor, hasMore: result.hasMore } }, { headers: { "cache-control": "private, no-store" } });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "MEDIA_CURSOR_INVALID") return error("VALIDATION_FAILED", "这批内容已变化，请重新换一批。", 400);
    return error("MEDIA_NOT_AVAILABLE", "换一批失败，请重试。", 503, true);
  }
}
