import { NextRequest, NextResponse } from "next/server";

import { createDrizzleConversationRepository, isConversationCharacterDiscoverable } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

function excerpt(text: string, query: string): string {
  const lowerText = text.toLocaleLowerCase();
  const index = lowerText.indexOf(query.toLocaleLowerCase());
  if (index < 0 || text.length <= 120) return text;
  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + query.length + 72);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function errorResponse(code: string, status: number, message: string, retryable = status >= 500) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, retryable } },
    { status },
  );
}

export async function GET(request: NextRequest) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401, "A valid user session is required.");

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ apiVersion: API_VERSION, data: { query: "", results: [] } });
  if (query.length > 120) {
    return errorResponse("INPUT_INVALID", 400, "The conversation search query is invalid.");
  }

  try {
    const results = await createDrizzleConversationRepository(getDatabase()).searchMessages(user.id, query, 50);
    return NextResponse.json({
      apiVersion: API_VERSION,
      data: {
        query,
        results: results.filter((result) => isConversationCharacterDiscoverable(result.characterKey)).map((result) => ({
          messageId: result.id,
          characterKey: result.characterKey,
          characterName: result.characterName,
          role: result.role,
          snippet: excerpt(result.content, query),
          createdAt: result.createdAt.toISOString(),
        })),
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("CONVERSATION_SEARCH_UNAVAILABLE", 503, "Conversation search is temporarily unavailable.");
  }
}
