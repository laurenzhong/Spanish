import { NextRequest, NextResponse } from "next/server";

import { createDrizzleIntroductionRepository } from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ memoryId: string; targetCharacterKey: string }> }>;

function errorResponse(code: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, retryable: status >= 500 } }, { status });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) return errorResponse("PERMISSIONS_UNAVAILABLE", 503);
  const { memoryId, targetCharacterKey } = await context.params;
  if (!/^[0-9a-f-]{36}$/iu.test(memoryId) || !/^[a-z0-9-]{3,80}$/u.test(targetCharacterKey)) {
    return errorResponse("INPUT_INVALID", 400);
  }
  try {
    await createDrizzleIntroductionRepository(getDatabase()).revokeMemoryPermission(user.id, memoryId, targetCharacterKey);
    return NextResponse.json({ data: { revoked: true, memoryId, targetCharacterKey } });
  } catch {
    return errorResponse("PERMISSION_REVOKE_FAILED", 503);
  }
}

