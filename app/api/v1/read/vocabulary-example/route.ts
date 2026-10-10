import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { createDrizzleLexiconCorpusRepository } from "@/src/modules/lexicon-corpus/repositories";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const querySchema = z.object({
  word: z.string().trim().min(1).max(40).regex(/^[\p{L}\p{M}'\u2019-]+$/u),
}).strict();

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 } },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "语料例句暂时无法读取。");

  const parsed = querySchema.safeParse({ word: request.nextUrl.searchParams.get("word") ?? undefined });
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "词语格式无效。");

  try {
    const example = await createDrizzleLexiconCorpusRepository(getDatabase()).findCorpusExample(parsed.data.word);
    return NextResponse.json(
      { apiVersion: API_VERSION, data: example },
      { headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "语料例句暂时无法读取。");
  }
}
