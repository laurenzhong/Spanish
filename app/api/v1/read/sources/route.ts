import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteExternalSource,
  listExternalSources,
  saveExternalSource,
  savedArticleSourceInputSchema,
} from "@/src/modules/reading";
import { createDrizzleReadingRepository } from "@/src/modules/reading/repositories";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const sourceIdSchema = z.string().uuid();

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable: status >= 500 } },
    { status },
  );
}

function serializeSource(source: Awaited<ReturnType<typeof listExternalSources>>[number]) {
  return {
    id: source.id,
    sourceUrl: source.sourceUrl,
    normalizedUrl: source.normalizedUrl,
    title: source.title,
    author: source.author,
    sourceName: source.sourceName,
    license: source.license,
    copyrightStatus: source.copyrightStatus,
    status: source.status,
    createdAt: source.createdAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "个人来源暂时无法读取。");
  try {
    const sources = await listExternalSources(createDrizzleReadingRepository(getDatabase()), user.id);
    return NextResponse.json({ apiVersion: API_VERSION, data: { sources: sources.map(serializeSource) } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "个人来源暂时无法读取。");
  }
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "个人来源暂时无法保存。");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "个人来源格式无效。");
  }
  const parsed = savedArticleSourceInputSchema.safeParse(body);
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "个人来源格式无效。");
  try {
    const source = await saveExternalSource(createDrizzleReadingRepository(getDatabase()), user.id, parsed.data);
    return NextResponse.json({ apiVersion: API_VERSION, data: { source: serializeSource(source), fetched: false } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "个人来源 URL 无效或暂不支持。");
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await getRequestUser(request, { verifyRequestUser, getCurrentUser });
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", 503, "个人来源暂时无法删除。");
  const parsed = sourceIdSchema.safeParse(request.nextUrl.searchParams.get("sourceId"));
  if (!parsed.success) return errorResponse(requestId, "VALIDATION_FAILED", 400, "个人来源 ID 无效。");
  try {
    const deleted = await deleteExternalSource(createDrizzleReadingRepository(getDatabase()), user.id, parsed.data);
    return NextResponse.json({ apiVersion: API_VERSION, data: { deleted } }, { headers: { "cache-control": "no-store" } });
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "个人来源暂时无法删除。");
  }
}
