import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createDrizzleLuciaContactRepository,
  getLuciaContact,
  respondToLuciaContact,
} from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

const decisionSchema = z.object({ decision: z.enum(["accept", "decline"]) });

function errorResponse(code: string, status: number): NextResponse {
  return NextResponse.json({ error: { code, retryable: status >= 500 } }, { status });
}

function toJson(contact: Awaited<ReturnType<typeof getLuciaContact>>): unknown {
  return {
    characterKey: contact.characterKey,
    status: contact.status,
    relationshipStage: contact.relationshipStage,
    conversationId: contact.conversationId,
    source: contact.source,
  };
}

export async function GET(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) return errorResponse("CONTACT_UNAVAILABLE", 503);
  try {
    const contact = await getLuciaContact({ repository: createDrizzleLuciaContactRepository(getDatabase()), userId: user.id });
    return NextResponse.json({ data: toJson(contact) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("CONTACT_UNAVAILABLE", 503);
  }
}

export async function POST(request: NextRequest) {
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("INPUT_INVALID", 400); }
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) return errorResponse("INPUT_INVALID", 400);
  if (!process.env.DATABASE_URL) return errorResponse("CONTACT_UNAVAILABLE", 503);
  try {
    const contact = await respondToLuciaContact({
      repository: createDrizzleLuciaContactRepository(getDatabase()),
      userId: user.id,
      decision: parsed.data.decision,
    });
    return NextResponse.json({ data: toJson(contact) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("CONTACT_UNAVAILABLE", 503);
  }
}
