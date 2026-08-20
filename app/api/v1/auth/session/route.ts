import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { verifyRequestUser } from "@/src/shared/auth/server";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await verifyRequestUser(request);

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
      { status: 401 },
    );
  }

  return NextResponse.json({
    apiVersion: API_VERSION,
    data: { userId: user.id, email: user.email },
  });
}
