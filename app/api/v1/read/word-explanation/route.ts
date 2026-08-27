import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { explainWord } from "@/src/modules/reading/application";
import {
  createMiniMaxWordExplanationProvider,
} from "@/src/modules/providers/word-explanation/server";
import { WordExplanationError } from "@/src/modules/providers/word-explanation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";

const inputSchema = z.object({
  word: z.string().trim().min(1).max(2_000),
  context: z.string().trim().min(1).max(2_000),
  locale: z.string().trim().min(1).max(32),
  selectionType: z.enum(["word", "sentence"]).default("word"),
}).strict();

function errorResponse(
  requestId: string,
  code: ApiErrorCode,
  status: number,
  message: string,
): NextResponse {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 || status === 429 } },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

function providerErrorResponse(requestId: string, error: WordExplanationError): NextResponse {
  if (error.code === "input-invalid") return errorResponse(requestId, "VALIDATION_FAILED", 400, "词语解释请求格式无效。");
  if (error.code === "provider-rate-limited") return errorResponse(requestId, "RATE_LIMITED", 429, "词语解释请求过于频繁，请稍后重试。");
  if (error.code === "provider-timeout") return errorResponse(requestId, "PROVIDER_TIMEOUT", 504, "词语解释生成超时，请稍后重试。");
  if (error.code === "provider-unavailable") return errorResponse(requestId, "PROVIDER_UNAVAILABLE", 503, "词语解释服务暂时不可用，请稍后重试。");
  return errorResponse(requestId, "INTERNAL_ERROR", 503, "词语解释暂时无法生成，请稍后重试。");
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user =
    (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "词语解释请求格式无效。");
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "词语解释请求格式无效。");

  try {
    const provider = createMiniMaxWordExplanationProvider();
    if (provider.explainStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const event of provider.explainStream!(parsed.data, { signal: request.signal })) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            controller.close();
          } catch (error) {
            const mapped = error instanceof WordExplanationError ? providerErrorResponse(requestId, error) : errorResponse(requestId, "INTERNAL_ERROR", 503, "词语解释暂时无法生成，请稍后重试。");
            const payload = await mapped.json() as { error?: { code?: string; message?: string; retryable?: boolean; requestId?: string } };
            controller.enqueue(encoder.encode(JSON.stringify({ type: "error", error: payload.error ?? { code: "INTERNAL_ERROR", message: "词语解释暂时无法生成，请稍后重试。", retryable: true, requestId } }) + "\n"));
            controller.close();
          }
        },
      });
      return new NextResponse(stream, { headers: { "cache-control": "no-store", "content-type": "application/x-ndjson; charset=utf-8", "x-request-id": requestId } });
    }
    const explanation = await explainWord(provider, parsed.data, { signal: request.signal });
    return NextResponse.json(
      { apiVersion: API_VERSION, data: explanation },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    if (error instanceof WordExplanationError) return providerErrorResponse(requestId, error);
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "词语解释暂时无法生成，请稍后重试。");
  }
}
