import { NextRequest, NextResponse } from "next/server";

import { listConversationPreviews } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

function errorResponse(code: string, status: number, message: string, retryable = status >= 500) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, retryable } },
    { status },
  );
}

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401, "A valid user session is required.");

  try {
    // The same read renders the chat layout's server-side first paint, so the
    // repository query and the capability-manifest recheck live in the
    // conversation application layer instead of in either transport.
    const conversations = await listConversationPreviews(getDatabase(), user.id);
    return NextResponse.json({
      apiVersion: API_VERSION,
      data: { conversations },
    }, { headers: { "cache-control": "no-store", "x-conversation-persistence": "available" } });
  } catch {
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        error: {
          code: "CONVERSATION_LIST_UNAVAILABLE",
          message: "Conversation list is temporarily unavailable.",
          retryable: true,
        },
      },
      { status: 503, headers: { "x-conversation-persistence": "unavailable" } },
    );
  }
}
