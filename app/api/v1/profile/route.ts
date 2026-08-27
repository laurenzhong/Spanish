import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getProfileOverview } from "@/src/modules/profile/application";
import { createDrizzleProfileRepository } from "@/src/modules/profile/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);

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

  try {
    const overview = await getProfileOverview(
      createDrizzleProfileRepository(getDatabase()),
      user.id,
    );

    return NextResponse.json({ apiVersion: API_VERSION, data: overview });
  } catch {
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        error: {
          code: "INTERNAL_ERROR",
          message: "Profile data is temporarily unavailable.",
          retryable: true,
          requestId,
        },
      },
      { status: 503 },
    );
  }
}
