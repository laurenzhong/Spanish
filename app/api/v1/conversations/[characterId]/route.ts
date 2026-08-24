import { NextRequest, NextResponse } from "next/server";

import { createDrizzleConversationRepository } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ characterId: string }> }>;

export async function GET(request: NextRequest, context: RouteContext) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });
  const { characterId } = await context.params;
  if (characterId !== "lucia") return NextResponse.json({ error: { code: "CHARACTER_UNAVAILABLE" } }, { status: 404 });
  try {
    const messages = await createDrizzleConversationRepository(getDatabase()).listMessages(user.id, characterId);
    return NextResponse.json({ data: { characterKey: characterId, messages: messages.map((message) => ({
      id: message.id,
      clientMessageId: message.role === "user" ? message.clientMessageId : undefined,
      generationId: message.generationId ?? undefined,
      role: message.role,
      text: message.content,
      complete: message.status === "completed",
    })) } });
  } catch {
    return NextResponse.json({ error: { code: "CONVERSATION_UNAVAILABLE", retryable: true } }, { status: 503 });
  }
}
