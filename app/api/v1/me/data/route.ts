import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ACCOUNT_DATA_CONFIRMATION,
  deleteAccountData,
  createDrizzlePrivacyRepository,
  createSupabaseStorageObjectDeleter,
  getAccountDataSummary,
} from "@/src/modules/privacy";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const deleteRequestSchema = z.object({
  confirmation: z.literal(ACCOUNT_DATA_CONFIRMATION),
});
const idempotencyKeySchema = z.string().trim().min(8).max(128);

function errorResponse(
  requestId: string,
  code: ApiErrorCode,
  status: number,
  message: string,
): NextResponse {
  return NextResponse.json(
    {
      apiVersion: API_VERSION,
      error: { code, message, requestId, retryable: status >= 500 },
    },
    { status },
  );
}

export async function DELETE(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user =
    (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) {
    return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "Account data deletion requires explicit confirmation.");
  }
  if (!deleteRequestSchema.safeParse(body).success) {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "Account data deletion requires explicit confirmation.");
  }
  const idempotencyKey = idempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!idempotencyKey.success) {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "Account data deletion requires an idempotency key.");
  }
  if (!process.env.DATABASE_URL) {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Account data deletion is temporarily unavailable.");
  }

  try {
    const repository = createDrizzlePrivacyRepository(getDatabase());
    const result = await deleteAccountData(
      repository,
      createSupabaseStorageObjectDeleter(),
      user.id,
    );
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        data: {
          alreadyDeleted: result.alreadyDeleted,
          cleanupDeferred: result.cleanupDeferred,
          evidenceDeleted: result.evidenceDeleted,
          providerCallsAnonymized: result.providerCallsAnonymized,
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Account data deletion is temporarily unavailable.");
  }
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user =
    (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) {
    return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  }
  if (!process.env.DATABASE_URL) {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Account data summary is temporarily unavailable.");
  }
  try {
    const summary = await getAccountDataSummary(
      createDrizzlePrivacyRepository(getDatabase()),
      user.id,
    );
    return NextResponse.json(
      { apiVersion: API_VERSION, data: summary },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Account data summary is temporarily unavailable.");
  }
}
