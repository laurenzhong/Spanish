import { NextRequest, NextResponse } from "next/server";

import { createDrizzleIntroductionRepository } from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

function errorResponse(code: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, retryable: status >= 500 } }, { status });
}

export async function GET(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) return NextResponse.json({ data: { permissions: [] } });
  try {
    const repository = createDrizzleIntroductionRepository(getDatabase());
    const permissions = await repository.listGrantedMemoryPreviews(user.id);
    return NextResponse.json({ data: { permissions } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("PERMISSIONS_UNAVAILABLE", 503);
  }
}

