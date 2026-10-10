import { NextRequest, NextResponse } from "next/server";

import { createDrizzleIntroductionRepository } from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  AUTH_REQUIRED: "A valid user session is required.",
  PERMISSIONS_UNAVAILABLE: "Shared memory permissions are temporarily unavailable.",
};

function errorResponse(code: ApiErrorCode, status: number): NextResponse {
  return NextResponse.json({
    apiVersion: API_VERSION,
    error: {
      code,
      message: ERROR_MESSAGES[code] ?? "Shared memory permissions request failed.",
      retryable: status >= 500,
    },
  }, { status });
}

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) return errorResponse("PERMISSIONS_UNAVAILABLE", 503);
  try {
    const repository = createDrizzleIntroductionRepository(getDatabase());
    const permissions = await repository.listGrantedMemoryPreviews(user.id);
    return NextResponse.json({ apiVersion: API_VERSION, data: { permissions } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("PERMISSIONS_UNAVAILABLE", 503);
  }
}
