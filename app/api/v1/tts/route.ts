import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { synthesizeReadAloud } from "@/src/modules/providers/tts/application/synthesize-read-aloud";
import { MiniMaxTtsError } from "@/src/modules/providers/tts/minimax-tts";
import { READ_ALOUD_POLICY } from "@/src/modules/providers/tts/policy";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";

const inputSchema = z.object({ text: z.string().trim().min(1).max(READ_ALOUD_POLICY.maxChunkCharacters), languageTag: z.literal("es-ES").default("es-ES") }).strict();

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, 401, "AUTH_REQUIRED", "请先登录后朗读。");
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(requestId, 400, "VALIDATION_FAILED", "朗读请求格式无效。");
  try {
    const result = await synthesizeReadAloud(user.id, parsed.data.text, request.signal);
    return new NextResponse(result.audio as BodyInit, { status: 200, headers: {
      "cache-control": "private, no-store", "content-type": "audio/mpeg",
      "content-length": String(result.audio.byteLength), "x-request-id": requestId,
      "x-tts-provider": result.metadata.provider, "x-tts-model": result.metadata.model,
      "x-tts-voice": result.metadata.voiceId,
    } });
  } catch (error) {
    if (error instanceof MiniMaxTtsError) {
      const status = error.code === "not-configured" ? 503 : error.code === "rate-limited" ? 429 : error.code === "cancelled" ? 499 : 502;
      return errorResponse(requestId, status, error.code === "rate-limited" ? "RATE_LIMITED" : "PROVIDER_UNAVAILABLE", error.code === "not-configured" ? "MiniMax 朗读尚未配置。" : "MiniMax 朗读暂时不可用，请稍后重试。");
    }
    return errorResponse(requestId, 502, "PROVIDER_UNAVAILABLE", "MiniMax 朗读暂时不可用，请稍后重试。");
  }
}

function errorResponse(requestId: string, status: number, code: ApiErrorCode, message: string) {
  return NextResponse.json({ apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 || status === 429 } }, { status, headers: { "cache-control": "private, no-store", "x-request-id": requestId } });
}
