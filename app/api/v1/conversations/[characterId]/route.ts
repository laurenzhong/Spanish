import { NextRequest, NextResponse } from "next/server";

import { createDrizzleConversationRepository } from "@/src/modules/conversation";
import { findConversationCharacter } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

type RouteContext = Readonly<{ params: Promise<{ characterId: string }> }>;

function serverTiming(entries: Readonly<Record<string, number>>): string {
  return Object.entries(entries)
    .map(([name, duration]) => `${name};dur=${Math.max(0, Math.round(duration))}`)
    .join(", ");
}

export async function GET(request: NextRequest, context: RouteContext) {
  const startedAt = Date.now();
  const authStartedAt = startedAt;
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  const authMs = Date.now() - authStartedAt;
  if (!user) return NextResponse.json(
    { error: { code: "AUTH_REQUIRED" } },
    { status: 401, headers: { "cache-control": "no-store", "server-timing": serverTiming({ auth: authMs, total: Date.now() - startedAt }) } },
  );
  const { characterId } = await context.params;
  if (!findConversationCharacter(characterId)) return NextResponse.json(
    { error: { code: "CHARACTER_UNAVAILABLE" } },
    { status: 404, headers: { "cache-control": "no-store", "server-timing": serverTiming({ auth: authMs, total: Date.now() - startedAt }) } },
  );
  const databaseStartedAt = Date.now();
  try {
    const messages = await createDrizzleConversationRepository(getDatabase()).listMessages(user.id, characterId);
    return NextResponse.json({ data: { characterKey: characterId, messages: messages.map((message) => ({
      id: message.id,
      clientMessageId: message.role === "user" ? message.clientMessageId : undefined,
      generationId: message.generationId ?? undefined,
      role: message.role,
      text: message.status === "withdrawn" ? "" : message.content,
      complete: message.status === "completed" || message.status === "withdrawn",
      status: message.status === "withdrawn" ? "withdrawn" : "completed",
      withdrawn: message.status === "withdrawn",
      createdAt: message.createdAt.toISOString(),
    })) } }, { headers: {
      "cache-control": "no-store",
      "server-timing": serverTiming({ auth: authMs, database: Date.now() - databaseStartedAt, total: Date.now() - startedAt }),
      "x-conversation-persistence": "available",
    } });
  } catch {
    return NextResponse.json(
      { error: { code: "CONVERSATION_UNAVAILABLE", retryable: true } },
      { status: 503, headers: {
        "cache-control": "no-store",
        "server-timing": serverTiming({ auth: authMs, database: Date.now() - databaseStartedAt, total: Date.now() - startedAt }),
        "x-conversation-persistence": "unavailable",
      } },
    );
  }
}
