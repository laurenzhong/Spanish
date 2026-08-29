import { NextRequest, NextResponse } from "next/server";

import { createDrizzleConversationRepository } from "@/src/modules/conversation";
import { findConversationCharacter } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export async function GET(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });

  try {
    const records = await createDrizzleConversationRepository(getDatabase()).listConversations(user.id);
    return NextResponse.json({
      data: {
        conversations: records.map((record) => {
          const character = findConversationCharacter(record.characterKey);
          return {
            conversationId: record.conversationId,
            characterKey: record.characterKey,
            characterName: record.characterName,
            avatarUrl: record.avatarUrl,
            avatarClass: character?.avatarClass ?? "avatar--lucia",
            roleLabel: character?.roleLabel ?? "角色",
            lastMessageAt: record.lastMessageAt?.toISOString() ?? null,
            isPinned: record.isPinned,
            isMuted: record.isMuted,
            sortRank: record.sortRank,
            lastMessage: record.lastMessage
              ? {
                  role: record.lastMessage.role,
                  snippet: record.lastMessage.content.slice(0, 160),
                  createdAt: record.lastMessage.createdAt.toISOString(),
                }
              : null,
          };
        }),
      },
    }, { headers: { "cache-control": "no-store", "x-conversation-persistence": "available" } });
  } catch {
    return NextResponse.json(
      { error: { code: "CONVERSATION_LIST_UNAVAILABLE", retryable: true } },
      { status: 503, headers: { "x-conversation-persistence": "unavailable" } },
    );
  }
}
