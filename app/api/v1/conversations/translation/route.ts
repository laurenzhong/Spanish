import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createMiniMaxTranslationProvider } from "@/src/modules/providers/translation/server";
import { TranslationError } from "@/src/modules/providers/translation";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";

const inputSchema = z.object({ text: z.string().trim().min(1).max(4_000), sourceLocale: z.string().trim().min(1).max(32).default("es-ES"), targetLocale: z.string().trim().min(1).max(32).default("zh-CN") }).strict();

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse(requestId, "VALIDATION_FAILED", 400, "翻译请求格式无效。"); }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "翻译请求格式无效。");
  try {
    const data = await createMiniMaxTranslationProvider().translate(parsed.data, { signal: request.signal });
    return NextResponse.json({ apiVersion: API_VERSION, data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof TranslationError) {
      const map: Record<string, { code: ApiErrorCode; status: number; message: string }> = {
        "provider-auth-failed": { code: "PROVIDER_UNAVAILABLE", status: 503, message: "翻译服务暂未配置。" },
        "provider-rate-limited": { code: "RATE_LIMITED", status: 429, message: "翻译请求过于频繁，请稍后重试。" },
        "provider-timeout": { code: "PROVIDER_TIMEOUT", status: 504, message: "翻译生成超时，请稍后重试。" },
        "provider-cancelled": { code: "PROVIDER_UNAVAILABLE", status: 499, message: "翻译已取消。" },
        "provider-response-invalid": { code: "PROVIDER_UNAVAILABLE", status: 503, message: "翻译结果暂时无效，请稍后重试。" },
        "provider-unavailable": { code: "PROVIDER_UNAVAILABLE", status: 503, message: "翻译服务暂时不可用，请稍后重试。" },
      };
      const mapped = map[error.code];
      return errorResponse(requestId, mapped.code, mapped.status, mapped.message);
    }
    return errorResponse(requestId, "PROVIDER_UNAVAILABLE", 503, "翻译服务暂时不可用，请稍后重试。");
  }
}

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json({ apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 || status === 429 } }, { status, headers: { "cache-control": "no-store", "x-request-id": requestId } });
}
