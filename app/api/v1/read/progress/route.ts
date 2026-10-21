import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { listReadingProgress } from "@/src/modules/reading";
import { createDrizzleReadingRepository } from "@/src/modules/reading/repositories";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
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
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "阅读进度暂时无法读取。");
  try {
    const progress = await listReadingProgress(createDrizzleReadingRepository(getDatabase()), user.id);
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        data: {
          progress: progress.map((item) => ({
            articleId: item.articleId,
            lastOpenedAt: item.lastOpenedAt.toISOString(),
            position: item.position,
            status: item.status,
          })),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "阅读进度暂时无法读取。");
  }
}
