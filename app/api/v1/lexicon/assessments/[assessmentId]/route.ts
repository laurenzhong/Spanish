import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { createDrizzleLexiconCorpusRepository, getAssessment, submitAssessmentAttempt, LexicalAssessmentConflictError, LexicalAssessmentNotFoundError } from "@/src/modules/lexicon-corpus";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type Context = Readonly<{ params: Promise<{ assessmentId: string }> }>;

function errorResponse(requestId: string, code: "AUTH_REQUIRED" | "VALIDATION_FAILED" | "RESOURCE_NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR", status: number, message: string) {
  return NextResponse.json({ apiVersion: API_VERSION, error: { code, message, retryable: status >= 500, requestId } }, { status });
}

function assessmentDto(item: NonNullable<Awaited<ReturnType<typeof getAssessment>>>) {
  return { id: item.id, assessmentKey: item.assessmentKey, version: item.version, entryKind: item.entryKind, entryId: item.entryId, promptType: item.promptType, prompt: item.prompt, options: item.options, sourceReference: item.sourceReference, contentVersion: item.contentVersion };
}

export async function GET(request: NextRequest, { params }: Context) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "文字考察暂时不可用。");
  try {
    const user = (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
    const item = await getAssessment(createDrizzleLexiconCorpusRepository(getDatabase()), user?.id, decodeURIComponent((await params).assessmentId));
    if (!item) return errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "文字考察不存在或已归档。");
    return NextResponse.json({ apiVersion: API_VERSION, data: assessmentDto(item) }, { headers: { "cache-control": user ? "private, no-store" : "public, max-age=60" } });
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "文字考察暂时不可用。");
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "需要登录后才能提交文字考察。");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "文字考察暂时不可用。");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) return errorResponse(requestId, "VALIDATION_FAILED", 400, "缺少幂等键。");
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse(requestId, "VALIDATION_FAILED", 400, "答案格式无效。"); }
  try {
    const result = await submitAssessmentAttempt(createDrizzleLexiconCorpusRepository(getDatabase()), user.id, decodeURIComponent((await params).assessmentId), body, idempotencyKey);
    return NextResponse.json({ apiVersion: API_VERSION, data: result }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof LexicalAssessmentNotFoundError) return errorResponse(requestId, "RESOURCE_NOT_FOUND", 404, "文字考察不存在或已归档。");
    if (error instanceof LexicalAssessmentConflictError) return errorResponse(requestId, "CONFLICT", 409, "该幂等键已经用于另一份答案。");
    if (error instanceof Error && error.name === "ZodError") return errorResponse(requestId, "VALIDATION_FAILED", 400, "答案格式无效。");
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "文字考察暂时不可用。");
  }
}
