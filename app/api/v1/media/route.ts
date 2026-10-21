import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { createDrizzleMediaRepository, listMedia, mediaListQuerySchema } from "@/src/modules/media";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const parsed = mediaListQuerySchema.safeParse({
    search: request.nextUrl.searchParams.get("search") || undefined,
    kind: request.nextUrl.searchParams.get("kind") || undefined,
    topic: request.nextUrl.searchParams.get("topic") || undefined,
    region: request.nextUrl.searchParams.get("region") || undefined,
    cefr: request.nextUrl.searchParams.get("cefr") || undefined,
    duration: request.nextUrl.searchParams.get("duration") || undefined,
    sort: request.nextUrl.searchParams.get("sort") || undefined,
    cursor: request.nextUrl.searchParams.get("cursor") || undefined,
    pageSize: Number(request.nextUrl.searchParams.get("pageSize") ?? 18),
  });
  if (!parsed.success) {
    return NextResponse.json({
      apiVersion: API_VERSION,
      error: { code: "VALIDATION_FAILED", message: "媒体筛选条件无效。", retryable: false, requestId },
    }, { status: 400 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      apiVersion: API_VERSION,
      error: { code: "MEDIA_NOT_AVAILABLE", message: "媒体资料库暂时不可用。", retryable: true, requestId },
    }, { status: 503 });
  }
  try {
    const user = (await verifyRequestUser(request))
      ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
    const result = await listMedia(createDrizzleMediaRepository(getDatabase()), parsed.data, user?.id);
    return NextResponse.json({
      apiVersion: API_VERSION,
      data: { items: result.items },
      page: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    }, { headers: { "cache-control": user ? "private, no-store" : "public, max-age=60" } });
  } catch (error) {
    const invalidCursor = error instanceof Error && error.message === "MEDIA_CURSOR_INVALID";
    return NextResponse.json({
      apiVersion: API_VERSION,
      error: {
        code: invalidCursor ? "VALIDATION_FAILED" : "MEDIA_NOT_AVAILABLE",
        message: invalidCursor ? "分页位置已失效，请重新加载。" : "媒体资料库暂时不可用。",
        retryable: !invalidCursor,
        requestId,
      },
    }, { status: invalidCursor ? 400 : 503 });
  }
}
