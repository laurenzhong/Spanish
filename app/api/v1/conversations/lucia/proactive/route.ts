import { NextRequest, NextResponse } from "next/server";

import {
  generateLuciaProactiveMessage,
  proactiveMessageSources,
  createDrizzleProactiveMessageRepository,
} from "@/src/modules/conversation";
import { createDrizzleMemoryRepository } from "@/src/modules/memory";
import { createMiniMaxConversationProvider, createOpenAIConversationProvider } from "@/src/modules/providers/conversation/server";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export async function POST(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: { code: "PROACTIVE_UNAVAILABLE", retryable: true } }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "INPUT_INVALID" } }, { status: 400 });
  }
  const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const source = typeof input.sourceType === "string" ? input.sourceType : "";
  if (!proactiveMessageSources.includes(source as (typeof proactiveMessageSources)[number])) {
    return NextResponse.json({ error: { code: "INPUT_INVALID" } }, { status: 400 });
  }
  const sourceEventId = input.sourceEventId === undefined || input.sourceEventId === null
    ? null
    : typeof input.sourceEventId === "string" && input.sourceEventId.length <= 200
      ? input.sourceEventId
      : "__invalid__";
  if (sourceEventId === "__invalid__") return NextResponse.json({ error: { code: "INPUT_INVALID" } }, { status: 400 });

  try {
    const database = getDatabase();
    const configuredProvider = process.env.CONVERSATION_PROVIDER?.trim().toLowerCase();
    const useOpenAI = configuredProvider === "openai" && Boolean(process.env.OPENAI_API_KEY?.trim());
    const useMiniMax = !useOpenAI && Boolean(process.env.MINIMAX_API_KEY?.trim());
    const provider = useOpenAI
      ? createOpenAIConversationProvider()
      : useMiniMax
        ? createMiniMaxConversationProvider()
        : undefined;
    const memoryRepository = createDrizzleMemoryRepository(database);
    const memories = await memoryRepository.listReadableMemories(user.id, "lucia");
    const result = await generateLuciaProactiveMessage({
      userId: user.id,
      source: source as (typeof proactiveMessageSources)[number],
      sourceEventId,
      repository: createDrizzleProactiveMessageRepository(database),
      provider,
      memories,
    });
    return NextResponse.json({
      data: {
        status: result.status,
        reason: result.reason ?? null,
        candidateId: result.candidate?.id ?? null,
        messageId: result.message?.id ?? result.candidate?.messageId ?? null,
      },
    }, { status: result.status === "generated" ? 201 : 200, headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: { code: "PROACTIVE_UNAVAILABLE", retryable: true } }, { status: 503 });
  }
}
