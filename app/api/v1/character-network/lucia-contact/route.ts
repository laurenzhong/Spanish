import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  createDrizzleLuciaContactRepository,
  getLuciaContact,
  respondToLuciaContact,
} from "@/src/modules/character-network";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const decisionSchema = z.object({ decision: z.enum(["accept", "decline"]) });

const ERROR_MESSAGES: Readonly<Partial<Record<ApiErrorCode, string>>> = {
  AUTH_REQUIRED: "A valid user session is required.",
  INPUT_INVALID: "The contact decision is invalid.",
  CONTACT_UNAVAILABLE: "Lucía's contact status is temporarily unavailable.",
};

function errorResponse(code: ApiErrorCode, status: number): NextResponse {
  return NextResponse.json({
    apiVersion: API_VERSION,
    error: {
      code,
      message: ERROR_MESSAGES[code] ?? "Lucía's contact request failed.",
      retryable: status >= 500,
    },
  }, { status });
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
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse("AUTH_REQUIRED", 401);
  if (!process.env.DATABASE_URL) return errorResponse("CONTACT_UNAVAILABLE", 503);
  try {
    const contact = await getLuciaContact({ repository: createDrizzleLuciaContactRepository(getDatabase()), userId: user.id });
    return NextResponse.json({ apiVersion: API_VERSION, data: toJson(contact) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("CONTACT_UNAVAILABLE", 503);
  }
}

export async function POST(request: NextRequest) {
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
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
    return NextResponse.json({ apiVersion: API_VERSION, data: toJson(contact) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse("CONTACT_UNAVAILABLE", 503);
  }
}
