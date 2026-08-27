import { NextRequest, NextResponse } from "next/server";

import { createDrizzleConversationRepository } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

function excerpt(text: string, query: string): string {
  const lowerText = text.toLocaleLowerCase();
  const index = lowerText.indexOf(query.toLocaleLowerCase());
  if (index < 0 || text.length <= 120) return text;
  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + query.length + 72);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export async function GET(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) return NextResponse.json({ data: { query: "", results: [] } });
  if (query.length > 120) {
    return NextResponse.json({ error: { code: "INPUT_INVALID" } }, { status: 400 });
  }

  try {
    const results = await createDrizzleConversationRepository(getDatabase()).searchMessages(user.id, query, 50);
    return NextResponse.json({
      data: {
        query,
        results: results.map((result) => ({
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
    return NextResponse.json({ error: { code: "CONVERSATION_SEARCH_UNAVAILABLE", retryable: true } }, { status: 503 });
  }
}
