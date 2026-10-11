import { randomUUID } from "node:crypto";

import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

import {
  LearningActivitySessionClosedError,
  LearningActivitySessionNotFoundError,
  recordLearningActivity,
  recordLearningActivityInputSchema,
} from "@/src/modules/profile/application";
import { createDrizzleProfileRepository } from "@/src/modules/profile/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import {
  API_VERSION,
  type ApiErrorCode,
} from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const sessionIdSchema = z.string().uuid();

function errorResponse(
  requestId: string,
  code: ApiErrorCode,
  status: number,
  message: string,
): NextResponse {
  return NextResponse.json(
    {
      apiVersion: API_VERSION,
      error: { code, message, requestId, retryable: status >= 500 },
    },
    { status },
  );
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  // Bearer token first (native clients), then the browser's Supabase cookie
  // session. Without the cookie fallback every heartbeat from the web app was
  // answered 401 AUTH_REQUIRED - verified end to end in a real signed-in
  // browser, where the client posted a valid `active` event and the database
  // stayed empty. The sibling profile/heatmap route resolves users the same way.
  const user = (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) {
    return errorResponse(
      requestId,
      "AUTH_REQUIRED",
      401,
      "A valid user session is required.",
    );
  }

  let sessionId: string;
  try {
    sessionId = sessionIdSchema.parse((await context.params).sessionId);
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "Invalid session ID.");
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "Invalid JSON body.");
  }
  const parsed = recordLearningActivityInputSchema.safeParse(input);
  if (!parsed.success) {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "Invalid activity event.");
  }

  try {
    const result = await recordLearningActivity(
      createDrizzleProfileRepository(getDatabase()),
      user.id,
      sessionId,
      parsed.data,
    );
    return NextResponse.json(
      { apiVersion: API_VERSION, data: result },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof LearningActivitySessionNotFoundError) {
      return errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "Practice session not found.");
    }
    if (error instanceof LearningActivitySessionClosedError) {
      return errorResponse(requestId, "CONFLICT", 409, "Practice session is already closed.");
    }
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Learning activity is temporarily unavailable.");
  }
}
