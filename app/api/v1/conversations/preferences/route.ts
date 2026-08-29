import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDrizzleConversationRepository } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

const preferenceSchema = z.object({
  characterKey: z.string().trim().min(1).max(80).optional(),
  isPinned: z.boolean().optional(),
  isMuted: z.boolean().optional(),
  sortRank: z.number().int().min(0).max(10_000).nullable().optional(),
  orderedCharacterKeys: z.array(z.string().trim().min(1).max(80)).min(1).max(100).optional(),
}).superRefine((value, context) => {
  if (value.orderedCharacterKeys) return;
  if (!value.characterKey || (value.isPinned === undefined && value.isMuted === undefined && value.sortRank === undefined)) {
    context.addIssue({ code: "custom", message: "At least one preference must be provided" });
  }
});

export async function PATCH(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });

  try {
    const input = preferenceSchema.parse(await request.json());
    const repository = createDrizzleConversationRepository(getDatabase());
    if (input.orderedCharacterKeys) {
      await repository.reorderConversationPreferences(user.id, input.orderedCharacterKeys);
      return NextResponse.json({ data: { orderedCharacterKeys: input.orderedCharacterKeys } }, { headers: { "cache-control": "no-store" } });
    }
    const preference = await repository.updateConversationPreference(user.id, input.characterKey!, {
      ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      ...(input.isMuted !== undefined ? { isMuted: input.isMuted } : {}),
      ...(input.sortRank !== undefined ? { sortRank: input.sortRank } : {}),
    });
    return NextResponse.json({ data: { preference } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: { code: "INVALID_REQUEST", details: error.issues } }, { status: 400 });
    }
    if (error instanceof Error && error.message === "CHARACTER_UNAVAILABLE") {
      return NextResponse.json({ error: { code: "CHARACTER_UNAVAILABLE" } }, { status: 404 });
    }
    return NextResponse.json({ error: { code: "CONVERSATION_PREFERENCE_UNAVAILABLE", retryable: true } }, { status: 503 });
  }
}
