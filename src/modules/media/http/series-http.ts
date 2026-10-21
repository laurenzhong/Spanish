import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { MediaUnavailableError } from "../domain/media";
import { MediaSeriesError } from "../domain/media-series";
import { createDrizzleMediaSeriesRepository } from "../repositories/drizzle-media-series-repository";
import { createMediaSeriesE2eRepository } from "../testing/media-series-e2e-fixture";
import { ContentWorkflowForbiddenError, isContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

function responseHeaders(requestId: string) {
  return { "cache-control": "private, no-store", "x-request-id": requestId };
}

function failure(requestId: string, code: string, status: number) {
  return NextResponse.json({
    apiVersion: API_VERSION,
    error: { code, message: status === 503 ? "系列资料暂时不可用，请重试。" : "无法完成系列请求。", retryable: status === 503, requestId },
  }, { status, headers: responseHeaders(requestId) });
}

export function mediaSeriesRepository() {
  const fixture = createMediaSeriesE2eRepository();
  if (fixture) return fixture;
  if (!process.env.DATABASE_URL) throw new MediaSeriesError("MEDIA_SERIES_UNAVAILABLE");
  return createDrizzleMediaSeriesRepository(getDatabase());
}

/** Bound both announced and streamed bodies before JSON parsing allocates objects. */
export async function readMediaSeriesCommandBody(request: Request): Promise<unknown> {
  const maximumBytes = 1024 * 1024;
  const announcedLength = request.headers.get("content-length");
  if (announcedLength !== null && Number(announcedLength) > maximumBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new MediaSeriesError("MEDIA_SERIES_COMMAND_INVALID");
  }
  if (!request.body) throw new MediaSeriesError("MEDIA_SERIES_COMMAND_INVALID");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  let completed = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        completed = true;
        break;
      }
      total += chunk.value.byteLength;
      if (total > maximumBytes) {
        throw new MediaSeriesError("MEDIA_SERIES_COMMAND_INVALID");
      }
      try { text += decoder.decode(chunk.value, { stream: true }); }
      catch { throw new MediaSeriesError("MEDIA_SERIES_COMMAND_INVALID"); }
    }
    try { text += decoder.decode(); }
    catch { throw new MediaSeriesError("MEDIA_SERIES_COMMAND_INVALID"); }
    return JSON.parse(text);
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function withMediaSeriesUser(
  request: NextRequest,
  action: (userId: string) => Promise<unknown>,
  ownerOnly = false,
) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
    const verified = await verifyRequestUser(request);
    // Explicit invalid bearer credentials must never be masked by a valid cookie.
    const user = verified ?? (!request.headers.has("authorization") && request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
    if (!user) return failure(requestId, "AUTH_REQUIRED", 401);
    if (ownerOnly && !isContentWorkflowOwner(user.id)) return failure(requestId, "CONTENT_WORKFLOW_FORBIDDEN", 403);
    const data = await action(user.id);
    return NextResponse.json({ apiVersion: API_VERSION, data }, { headers: responseHeaders(requestId) });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return failure(requestId, ownerOnly ? "MEDIA_SERIES_COMMAND_INVALID" : "MEDIA_SERIES_QUERY_INVALID", 400);
    }
    if (error instanceof ContentWorkflowForbiddenError) return failure(requestId, error.code, 403);
    if (error instanceof MediaUnavailableError) return failure(requestId, "MEDIA_NOT_AVAILABLE", 404);
    if (error instanceof MediaSeriesError) {
      const status = error.code === "MEDIA_SERIES_NOT_AVAILABLE" ? 404
        : error.code.endsWith("_INVALID") ? 400
          : error.code.endsWith("_CONFLICT") ? 409 : 503;
      return failure(requestId, error.code, status);
    }
    return failure(requestId, "MEDIA_SERIES_UNAVAILABLE", 503);
  }
}
