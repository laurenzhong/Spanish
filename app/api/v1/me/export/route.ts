import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { exportAccountData } from "@/src/modules/privacy";
import { createDrizzlePrivacyRepository } from "@/src/modules/privacy";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const EXPORT_FILENAME = "sueno-account-export.json";

/**
 * GET /api/v1/me/export — versioned JSON attachment of the caller's own data
 * (ACCT-ADMIN-001 design §5.3). Read-only: it never writes evidence, memory or
 * any other row. Oversized sections are capped and flagged as truncated.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, {
    verifyRequestUser,
    getCurrentUser,
  });
  if (!user) {
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        error: {
          code: "AUTH_REQUIRED",
          message: "A valid user session is required.",
          retryable: false,
          requestId,
        },
      },
      { status: 401, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }

  if (!process.env.DATABASE_URL) {
    return exportUnavailable(requestId);
  }

  try {
    const document = await exportAccountData(
      createDrizzlePrivacyRepository(getDatabase()),
      user.id,
      { now: new Date() },
    );
    return new NextResponse(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${EXPORT_FILENAME}"`,
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch {
    return exportUnavailable(requestId);
  }
}

function exportUnavailable(requestId: string): NextResponse {
  return NextResponse.json(
    {
      apiVersion: API_VERSION,
      error: {
        code: "EXPORT_UNAVAILABLE",
        message: "The account export is temporarily unavailable. Retry later.",
        retryable: true,
        requestId,
      },
    },
    { status: 503, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
