import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createDrizzlePrivacyRepository,
  deleteLuciaData,
  LUCIA_DATA_RESET_CONFIRMATION,
} from "@/src/modules/privacy";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const resetRequestSchema = z.object({
  confirmation: z.literal(LUCIA_DATA_RESET_CONFIRMATION),
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

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) {
    return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "Lucía data reset requires explicit confirmation.");
  }
  if (!resetRequestSchema.safeParse(body).success) {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "Lucía data reset requires explicit confirmation.");
  }
  if (!idempotencyKeySchema.safeParse(request.headers.get("idempotency-key")).success) {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "Lucía data reset requires an idempotency key.");
  }
  if (!process.env.DATABASE_URL) {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Lucía data reset is temporarily unavailable.");
  }

  try {
    const result = await deleteLuciaData(
      createDrizzlePrivacyRepository(getDatabase()),
      user.id,
    );
    return NextResponse.json(
      { apiVersion: API_VERSION, data: result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Lucía data reset is temporarily unavailable.");
  }
}
