import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createMiniMaxTextToSpeech, MiniMaxTtsError } from "@/src/modules/providers/tts/minimax-tts";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";

const inputSchema = z.object({ text: z.string().trim().min(1).max(4_000), languageTag: z.literal("es-ES").default("es-ES") }).strict();

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) return errorResponse(requestId, 401, "AUTH_REQUIRED", "A valid user session is required.");
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(requestId, 400, "VALIDATION_FAILED", "朗读请求格式无效。");
  try {
    const audio = await createMiniMaxTextToSpeech().synthesize(parsed.data.text, request.signal);
    return new NextResponse(audio as BodyInit, { status: 200, headers: { "cache-control": "no-store", "content-type": "audio/mpeg", "content-length": String(audio.byteLength), "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof MiniMaxTtsError) {
      const status = error.code === "not-configured" ? 503 : error.code === "rate-limited" ? 429 : error.code === "cancelled" ? 499 : 502;
      return errorResponse(requestId, status, "PROVIDER_UNAVAILABLE", error.code === "not-configured" ? "MiniMax 朗读尚未配置。" : "MiniMax 朗读暂时不可用。");
    }
    return errorResponse(requestId, 502, "PROVIDER_UNAVAILABLE", "MiniMax 朗读暂时不可用。");
  }
}

function errorResponse(requestId: string, status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, requestId, retryable: status >= 500 || status === 429 } }, { status, headers: { "cache-control": "no-store", "x-request-id": requestId } });
}
