import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { listCorpusExamples } from "@/src/modules/lexicon-corpus/application/list-corpus-examples";
import { createCorpusExamplesRepository } from "@/src/modules/lexicon-corpus/repositories/corpus-examples-repository";
import { corpusExamplesQuerySchema } from "@/src/modules/lexicon-corpus/schemas/corpus-examples";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const fail = (code: string, message: string, status: number) => NextResponse.json({ apiVersion: API_VERSION, error: { code, message, retryable: status === 503, requestId } }, { status, headers: { "cache-control": "private, no-store" } });
  try {
    const user = await verifyRequestUser(request) ?? (request.headers.has("authorization") ? null : await getCurrentUser());
    if (!user) return fail("AUTH_REQUIRED", "请先登录。", 401);
    const parsed = corpusExamplesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return fail("VALIDATION_FAILED", "请检查查询条件。", 400);
    if (!process.env.DATABASE_URL) return fail("CORPUS_UNAVAILABLE", "真实用例暂时不可用。", 503);
    const data = await listCorpusExamples(createCorpusExamplesRepository(getDatabase()), user.id, parsed.data);
    return NextResponse.json({ apiVersion: API_VERSION, data }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return fail("CORPUS_UNAVAILABLE", "真实用例暂时不可用，请重试。", 503);
  }
}
