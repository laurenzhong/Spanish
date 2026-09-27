import { NextRequest, NextResponse } from "next/server";

import { createDrizzleIntroductionRepository } from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ memoryId: string; targetCharacterKey: string }> }>;

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  AUTH_REQUIRED: "A valid user session is required.",
  INPUT_INVALID: "The permission request is invalid.",
  PERMISSIONS_UNAVAILABLE: "Shared memory permissions are temporarily unavailable.",
  PERMISSION_REVOKE_FAILED: "The shared memory permission could not be revoked.",
};

function errorResponse(code: ApiErrorCode, status: number): NextResponse {
  return NextResponse.json({
    apiVersion: API_VERSION,
    error: {
      code,
      message: ERROR_MESSAGES[code] ?? "Shared memory permission request failed.",
      retryable: status >= 500,
    },
  }, { status });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) return errorResponse("PERMISSIONS_UNAVAILABLE", 503);
  const { memoryId, targetCharacterKey } = await context.params;
  if (!/^[0-9a-f-]{36}$/iu.test(memoryId) || !/^[a-z0-9-]{3,80}$/u.test(targetCharacterKey)) {
    return errorResponse("INPUT_INVALID", 400);
  }
  try {
    await createDrizzleIntroductionRepository(getDatabase()).revokeMemoryPermission(user.id, memoryId, targetCharacterKey);
    return NextResponse.json({ apiVersion: API_VERSION, data: { revoked: true, memoryId, targetCharacterKey } });
  } catch {
    return errorResponse("PERMISSION_REVOKE_FAILED", 503);
  }
}
