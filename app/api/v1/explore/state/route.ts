import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDrizzleExploreUserStateRepository } from "@/src/modules/explore/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const stateSchema = z.object({
  stableKey: z.string().trim().min(1).max(160),
  version: z.number().int().positive(),
  totalSteps: z.number().int().positive(),
  completedSteps: z.number().int().min(0),
  saved: z.boolean().optional(),
});

function errorResponse(requestId: string, code: ApiErrorCode | "EXPLORE_STATE_UNAVAILABLE", status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 } },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

async function auth(request: NextRequest) {
  return (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await auth(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "需要有效的用户会话。");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "EXPLORE_STATE_UNAVAILABLE", 503, "探索进度暂时无法同步，请稍后重试。");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "探索进度格式无效。");
  }
  const parsed = stateSchema.safeParse(body);
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "探索进度格式无效。");
  try {
    const state = await createDrizzleExploreUserStateRepository(getDatabase()).setPackState(
      user.id,
      { stableKey: parsed.data.stableKey, version: parsed.data.version, totalSteps: parsed.data.totalSteps },
      { completedSteps: parsed.data.completedSteps, ...(parsed.data.saved === undefined ? {} : { saved: parsed.data.saved }) },
    );
    return NextResponse.json({ apiVersion: API_VERSION, data: { stableKey: parsed.data.stableKey, version: parsed.data.version, ...state } }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch {
    return errorResponse(requestId, "EXPLORE_STATE_UNAVAILABLE", 503, "探索进度暂时无法同步，请稍后重试。");
  }
}
