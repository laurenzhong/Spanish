import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { OwnerForbiddenError } from "@/src/shared/auth/owner";
import { isOwnerPrincipal } from "@/src/shared/auth/owner";
import { readAccountAccess } from "@/src/shared/auth/account-access";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

import { AdminActionError } from "../errors";
import {
  createDrizzleAdminAuditRepository,
  type AdminAuditRepository,
} from "../repositories/admin-audit-repository";

export type AdminRequestContext = Readonly<{
  ownerId: string;
  ownerEmail: string | null;
  requestId: string;
  database: ReturnType<typeof getDatabase>;
  auditRepository: AdminAuditRepository;
}>;

const PRIVATE_HEADERS = {
  "cache-control": "private, no-store",
} as const;

export function adminRequestId(request: NextRequest): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9_-]{8,128}$/u.test(supplied)
    ? supplied
    : randomUUID();
}

export function adminErrorResponse(
  requestId: string,
  code: ApiErrorCode,
  status: number,
  message: string,
  retryable = false,
): NextResponse {
  return NextResponse.json(
    {
      apiVersion: API_VERSION,
      error: { code, message, retryable, requestId },
    },
    {
      status,
      headers: { ...PRIVATE_HEADERS, "x-request-id": requestId },
    },
  );
}

export function adminSuccess(
  data: unknown,
  requestId: string,
  status = 200,
): NextResponse {
  return NextResponse.json(
    { apiVersion: API_VERSION, data },
    { status, headers: { ...PRIVATE_HEADERS, "x-request-id": requestId } },
  );
}

function isCodedError(
  error: unknown,
): error is { code: ApiErrorCode; message: string; status?: number; retryable?: boolean } {
  return (
    error instanceof AdminActionError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string" &&
      "message" in error)
  );
}

/**
 * Owner-only wrapper for /api/v1/admin/* Route Handlers.
 *
 * Order matters and is fail-closed:
 *   1. resolve the request identity (401);
 *   2. resolve account access and require owner (env allowlist ∪ profiles.role);
 *   3. require a configured database (503);
 *   4. run the action, mapping stable errors to the versioned envelope.
 */
export async function withAdminOwner(
  request: NextRequest,
  action: (context: AdminRequestContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = adminRequestId(request);
  let user;
  try {
    user = await getRequestUser(request, {
      verifyRequestUser,
      getCurrentUser,
    });
  } catch {
    return adminErrorResponse(
      requestId,
      "ADMIN_UNAVAILABLE",
      503,
      "The admin console is temporarily unavailable.",
      true,
    );
  }
  if (!user) {
    return adminErrorResponse(
      requestId,
      "AUTH_REQUIRED",
      401,
      "A valid user session is required.",
    );
  }

  const access = await readAccountAccess(user.id);
  if (!isOwnerPrincipal({ id: user.id, access })) {
    return adminErrorResponse(
      requestId,
      "ADMIN_FORBIDDEN",
      403,
      "This console is restricted to the configured project owner.",
    );
  }

  if (!process.env.DATABASE_URL) {
    return adminErrorResponse(
      requestId,
      "ADMIN_UNAVAILABLE",
      503,
      "The admin console database is unavailable.",
      true,
    );
  }

  const database = getDatabase();
  try {
    return await action({
      ownerId: user.id,
      ownerEmail: user.email,
      requestId,
      database,
      auditRepository: createDrizzleAdminAuditRepository(database),
    });
  } catch (error) {
    if (error instanceof OwnerForbiddenError) {
      return adminErrorResponse(requestId, error.code, 403, error.message);
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return adminErrorResponse(
        requestId,
        "VALIDATION_FAILED",
        400,
        "The request input is invalid.",
      );
    }
    if (isCodedError(error) && typeof error.status === "number") {
      return adminErrorResponse(
        requestId,
        error.code,
        error.status,
        error.message,
        error.retryable ?? false,
      );
    }
    return adminErrorResponse(
      requestId,
      "ADMIN_UNAVAILABLE",
      503,
      "The admin console is temporarily unavailable.",
      true,
    );
  }
}
