import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { createDrizzleLexiconCorpusRepository, setLexicalIntent } from "@/src/modules/lexicon-corpus";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type Context = Readonly<{ params: Promise<{ entryId: string }> }>;

export async function PUT(request: NextRequest, { params }: Context) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) return NextResponse.json({ apiVersion: API_VERSION, error: { code: "AUTH_REQUIRED", message: "需要登录后才能保存词句意图。", retryable: false, requestId } }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ apiVersion: API_VERSION, error: { code: "INTERNAL_ERROR", message: "词句意图暂时无法保存。", retryable: true, requestId } }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ apiVersion: API_VERSION, error: { code: "VALIDATION_FAILED", message: "词句意图格式无效。", retryable: false, requestId } }, { status: 400 }); }
  try {
    const result = await setLexicalIntent(createDrizzleLexiconCorpusRepository(getDatabase()), user.id, decodeURIComponent((await params).entryId), body);
    return NextResponse.json({ apiVersion: API_VERSION, data: result }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const conflict = error instanceof Error && error.name === "LexicalIntentConflictError";
    return NextResponse.json({ apiVersion: API_VERSION, error: { code: conflict ? "CONFLICT" : "VALIDATION_FAILED", message: conflict ? "词句意图已更新，请重新加载。" : "词句意图格式无效。", retryable: false, requestId } }, { status: conflict ? 409 : 400 });
  }
}
