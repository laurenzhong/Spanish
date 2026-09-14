import { NextRequest, NextResponse } from "next/server";

import { createDrizzleConversationRepository, toConversationPreviews } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export async function GET(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });

  try {
    const records = await createDrizzleConversationRepository(getDatabase()).listConversations(user.id);
    return NextResponse.json({
      data: {
        conversations: toConversationPreviews(records),
      },
    }, { headers: { "cache-control": "no-store", "x-conversation-persistence": "available" } });
  } catch {
    return NextResponse.json(
      { error: { code: "CONVERSATION_LIST_UNAVAILABLE", retryable: true } },
      { status: 503, headers: { "x-conversation-persistence": "unavailable" } },
    );
  }
}
