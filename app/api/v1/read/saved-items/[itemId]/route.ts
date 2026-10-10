import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { deleteSavedReadingItem, savedReadingItemIdSchema } from "@/src/modules/reading";
import { createDrizzleReadingRepository } from "@/src/modules/reading/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ itemId: string }> }>;

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 } },
    { status },
  );
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "已保存词句暂时无法修改。");
  let rawItemId: string;
  try {
    rawItemId = decodeURIComponent((await params).itemId);
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "已保存词句 ID 无效。");
  }
  const parsed = savedReadingItemIdSchema.safeParse(rawItemId);
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "已保存词句 ID 无效。");
  try {
    const deleted = await deleteSavedReadingItem(createDrizzleReadingRepository(getDatabase()), user.id, parsed.data);
    // Keep deletion idempotent and avoid revealing whether an inaccessible UUID
    // belongs to another user.
    return NextResponse.json({ apiVersion: API_VERSION, data: { id: parsed.data, deleted } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "已保存词句暂时无法移除。");
  }
}
