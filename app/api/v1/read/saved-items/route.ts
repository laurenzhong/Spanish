import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  listSavedShelfItems,
  projectSavedShelfItem,
  savedShelfQuerySchema,
} from "@/src/modules/reading";
import { createDrizzleReadingRepository } from "@/src/modules/reading/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 } },
    { status },
  );
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "已保存内容暂时无法读取。");

  const params = request.nextUrl.searchParams;
  const parsed = savedShelfQuerySchema.safeParse({
    search: params.get("search") ?? undefined,
    itemType: params.get("itemType") ?? params.get("type") ?? undefined,
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "已保存内容筛选条件无效。");

  try {
    const result = await listSavedShelfItems(
      createDrizzleReadingRepository(getDatabase()),
      user.id,
      parsed.data,
    );
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        data: {
          ...result,
          items: result.items.map(projectSavedShelfItem),
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "已保存内容暂时无法读取。");
  }
}
