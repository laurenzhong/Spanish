import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDrizzleConversationRepository } from "@/src/modules/conversation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

const preferenceSchema = z.object({
  characterKey: z.string().trim().min(1).max(80),
  isPinned: z.boolean().optional(),
  isMuted: z.boolean().optional(),
}).refine((value) => value.isPinned !== undefined || value.isMuted !== undefined, {
  message: "At least one preference must be provided",
});

export async function PATCH(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return NextResponse.json({ error: { code: "AUTH_REQUIRED" } }, { status: 401 });

  try {
    const input = preferenceSchema.parse(await request.json());
    const preference = await createDrizzleConversationRepository(getDatabase()).updateConversationPreference(
      user.id,
      input.characterKey,
      { isPinned: input.isPinned, isMuted: input.isMuted },
    );
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
