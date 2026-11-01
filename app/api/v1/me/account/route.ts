import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  AccountActionError,
  createDrizzleAccountAdminRepository,
  createSupabaseAccountProvisioner,
  deleteOwnAccount,
  idempotencyKeySchema,
  selfAccountDeletionRequestSchema,
} from "@/src/modules/account";
import { createDrizzleDiagnosticEventRepository } from "@/src/modules/observability";
import {
  createDrizzlePrivacyRepository,
  createSupabaseStorageObjectDeleter,
} from "@/src/modules/privacy";
import { createDrizzleAdminAuditRepository } from "@/src/modules/admin";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import {
  API_VERSION,
  type ApiErrorCode,
} from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const HEADERS = { "cache-control": "no-store" } as const;

function errorResponse(
  requestId: string,
  code: ApiErrorCode,
  status: number,
  message: string,
  retryable = false,
): NextResponse {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, retryable, requestId } },
    { status, headers: { ...HEADERS, "x-request-id": requestId } },
  );
}

/**
 * DELETE /api/v1/me/account — self-service account deletion (data right).
 *
 * Requires `{ confirmation: "DELETE_MY_ACCOUNT" }` and an `Idempotency-Key`.
 * Shares the deletion orchestration with owner-initiated deletion; after a
 * successful response the client clears its local session.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, {
    verifyRequestUser,
    getCurrentUser,
  });
  if (!user) {
    return errorResponse(
      requestId,
      "AUTH_REQUIRED",
      401,
      "A valid user session is required.",
    );
  }

  const idempotencyKey = idempotencyKeySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!idempotencyKey.success) {
    return errorResponse(
      requestId,
      "VALIDATION_FAILED",
      400,
      "Account deletion requires an Idempotency-Key header.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(
      requestId,
      "VALIDATION_FAILED",
      400,
      "Account deletion requires explicit confirmation.",
    );
  }
  if (!selfAccountDeletionRequestSchema.safeParse(body).success) {
    return errorResponse(
      requestId,
      "VALIDATION_FAILED",
      400,
      "Account deletion requires explicit confirmation.",
    );
  }

  if (!process.env.DATABASE_URL) {
    return errorResponse(
      requestId,
      "ACCOUNT_PROVISIONING_FAILED",
      503,
      "Account deletion is temporarily unavailable.",
      true,
    );
  }

  try {
    const database = getDatabase();
    const data = await deleteOwnAccount(
      {
        repository: createDrizzleAccountAdminRepository(database),
        auditRepository: createDrizzleAdminAuditRepository(database),
        privacyRepository: createDrizzlePrivacyRepository(database),
        storageDeleter: createSupabaseStorageObjectDeleter(),
        diagnostics: createDrizzleDiagnosticEventRepository(database),
        provisioner: createSupabaseAccountProvisioner(),
      },
      { userId: user.id, requestId },
    );
    return NextResponse.json(
      { apiVersion: API_VERSION, data },
      { headers: { ...HEADERS, "x-request-id": requestId } },
    );
  } catch (error) {
    if (error instanceof AccountActionError) {
      return errorResponse(
        requestId,
        error.code,
        error.status,
        error.message,
        error.retryable,
      );
    }
    return errorResponse(
      requestId,
      "ACCOUNT_PROVISIONING_FAILED",
      503,
      "Account deletion is temporarily unavailable.",
      true,
    );
  }
}
