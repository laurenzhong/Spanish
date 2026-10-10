import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDrizzleConversationRepository } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const preferenceSchema = z.object({
  characterKey: z.string().trim().min(1).max(80).optional(),
  isPinned: z.boolean().optional(),
  isMuted: z.boolean().optional(),
  sortRank: z.number().int().min(0).max(10_000).nullable().optional(),
  markRead: z.boolean().optional(),
  orderedCharacterKeys: z.array(z.string().trim().min(1).max(80)).min(1).max(100).optional(),
}).superRefine((value, context) => {
  if (value.orderedCharacterKeys) return;
  if (!value.characterKey || (value.isPinned === undefined && value.isMuted === undefined && value.sortRank === undefined && value.markRead === undefined)) {
    context.addIssue({ code: "custom", message: "At least one preference must be provided" });
  }
});

export async function PATCH(request: NextRequest) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401, "A valid user session is required.");

  try {
    const input = preferenceSchema.parse(await request.json());
    const repository = createDrizzleConversationRepository(getDatabase());
    if (input.orderedCharacterKeys) {
      await repository.reorderConversationPreferences(user.id, input.orderedCharacterKeys);
      return NextResponse.json({ apiVersion: API_VERSION, data: { orderedCharacterKeys: input.orderedCharacterKeys } }, { headers: { "cache-control": "no-store" } });
    }
    if (input.markRead) {
      await repository.markConversationRead(user.id, input.characterKey!);
      return NextResponse.json({ apiVersion: API_VERSION, data: { characterKey: input.characterKey, markRead: true } }, { headers: { "cache-control": "no-store" } });
    }
    const preference = await repository.updateConversationPreference(user.id, input.characterKey!, {
      ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      ...(input.isMuted !== undefined ? { isMuted: input.isMuted } : {}),
      ...(input.sortRank !== undefined ? { sortRank: input.sortRank } : {}),
    });
    return NextResponse.json({ apiVersion: API_VERSION, data: { preference } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse("INPUT_INVALID", 400, "The conversation preference request is invalid.", error.issues);
    }
    if (error instanceof Error && error.message === "CHARACTER_UNAVAILABLE") {
      return errorResponse("CHARACTER_UNAVAILABLE", 404, "This character is not available.");
    }
    return errorResponse("CONVERSATION_PREFERENCE_UNAVAILABLE", 503, "Conversation preferences are temporarily unavailable.");
  }
}

function errorResponse(
  code: ApiErrorCode,
  status: number,
  message: string,
  details?: readonly unknown[],
) {
  return NextResponse.json(
    {
      apiVersion: API_VERSION,
      error: {
        code,
        message,
        retryable: status >= 500,
        ...(details ? { details: { issues: details } } : {}),
      },
    },
    { status },
  );
}
