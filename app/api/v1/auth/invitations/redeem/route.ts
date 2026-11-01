import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  AccountActionError,
  clearRedeemAttempts,
  clientAddressHash,
  consumeRedeemAttempt,
  createDrizzleAccountAdminRepository,
  createSupabaseAccountProvisioner,
  redeemAccountInvitation,
  redeemInvitationRequestSchema,
} from "@/src/modules/account";
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
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    {
      apiVersion: API_VERSION,
      error: { code, message, retryable, requestId },
    },
    {
      status,
      headers: { ...HEADERS, "x-request-id": requestId, ...extraHeaders },
    },
  );
}

/**
 * Public invitation redemption (`/join` → ACCT-ADMIN-001 design §3.3).
 *
 * Fail-closed order:
 *   1. `ACCOUNT_INVITATIONS_ENABLED === "1"` (otherwise 403 REGISTRATION_CLOSED);
 *   2. process-level IP limit (429, logs only an IP hash);
 *   3. request validation (400);
 *   4. atomic invitation CAS + Supabase Auth provisioning in the application.
 *
 * Invalid, expired, revoked, already-used and email-mismatched invitations all
 * return the same `400 INVITATION_INVALID` so the endpoint cannot enumerate
 * accounts or invitation states.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();

  if (process.env.ACCOUNT_INVITATIONS_ENABLED !== "1") {
    return errorResponse(
      requestId,
      "REGISTRATION_CLOSED",
      403,
      "Invitation registration is not enabled.",
    );
  }

  const clientHash = clientAddressHash(request);
  const rateLimit = consumeRedeemAttempt(clientHash);
  if (!rateLimit.allowed) {
    console.warn(
      `[account-invitation] redeem_rate_limited ipHash=${clientHash}`,
    );
    return errorResponse(
      requestId,
      "RATE_LIMITED",
      429,
      "Too many invitation attempts. Try again later.",
      true,
      { "retry-after": String(rateLimit.retryAfterSeconds) },
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
      "The request body must be valid JSON.",
    );
  }
  const parsed = redeemInvitationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      requestId,
      "VALIDATION_FAILED",
      400,
      "The invitation input is invalid.",
    );
  }

  if (!process.env.DATABASE_URL) {
    return errorResponse(
      requestId,
      "ACCOUNT_PROVISIONING_FAILED",
      503,
      "Account provisioning is temporarily unavailable.",
      true,
    );
  }
  const provisioner = createSupabaseAccountProvisioner();
  if (!provisioner) {
    // Fail closed without consuming the single-use invitation: once the server
    // secret is configured the owner can still hand the same code out.
    return errorResponse(
      requestId,
      "ACCOUNT_PROVISIONING_FAILED",
      503,
      "Account provisioning is not configured.",
      true,
    );
  }

  try {
    const result = await redeemAccountInvitation(
      {
        repository: createDrizzleAccountAdminRepository(getDatabase()),
        provisioner,
        registrationEnabled: true,
      },
      parsed.data,
    );
    clearRedeemAttempts(clientHash);
    return NextResponse.json(
      { apiVersion: API_VERSION, data: result },
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
      "Account provisioning failed.",
      true,
    );
  }
}
