import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { createDrizzleLexiconCorpusRepository, corpusQuerySchema, searchCorpus } from "@/src/modules/lexicon-corpus";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const parsed = corpusQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ apiVersion: API_VERSION, error: { code: "VALIDATION_FAILED", message: "语料查询条件无效。", retryable: false, requestId } }, { status: 400 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ apiVersion: API_VERSION, error: { code: "INTERNAL_ERROR", message: "语料库暂时不可用。", retryable: true, requestId } }, { status: 503 });
  try {
    const user = (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
    const result = await searchCorpus(createDrizzleLexiconCorpusRepository(getDatabase()), user?.id, parsed.data);
    return NextResponse.json({ apiVersion: API_VERSION, data: result }, { headers: { "cache-control": user ? "private, no-store" : "public, max-age=60" } });
  } catch {
    return NextResponse.json({ apiVersion: API_VERSION, error: { code: "INTERNAL_ERROR", message: "语料库暂时不可用。", retryable: true, requestId } }, { status: 503 });
  }
}
