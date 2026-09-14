import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  createDrizzleMediaRepository,
  MediaProgressConflictError,
  MediaUnavailableError,
  saveMediaProgress,
  saveMediaProgressSchema,
} from "@/src/modules/media";
import { getVideoLearningE2eFixture } from "@/src/modules/media/testing/video-learning-e2e-fixture";
import { getPodcastLearningE2eFixture } from "@/src/modules/media/testing/podcast-learning-e2e-fixture";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type Context = Readonly<{ params: Promise<{ stableKey: string }> }>;

function errorResponse(requestId: string, code: ApiErrorCode, status: number, message: string) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, retryable: status >= 500, requestId } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function requestUser(request: NextRequest) {
  return (await verifyRequestUser(request))
    ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
}

export async function PUT(request: NextRequest, { params }: Context) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await requestUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "媒体学习进度格式无效。");
  }
  const parsed = saveMediaProgressSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "媒体学习进度格式无效。");
  }

  try {
    const stableKey = decodeURIComponent((await params).stableKey);
    const e2eFixture = getVideoLearningE2eFixture(stableKey) ?? getPodcastLearningE2eFixture(stableKey);
    if (e2eFixture) {
      const segmentExists = parsed.data.lastSegmentIndex === null
        || e2eFixture.segments.some((segment) => segment.index === parsed.data.lastSegmentIndex);
      if (parsed.data.version !== e2eFixture.media.version
        || parsed.data.lastPositionMs > e2eFixture.media.durationMs
        || !segmentExists) {
        return errorResponse(requestId, "VALIDATION_FAILED", 400, "媒体学习进度超出内容范围。");
      }
      return NextResponse.json({
        apiVersion: API_VERSION,
        data: { progress: { ...parsed.data, revision: parsed.data.expectedRevision + 1 } },
      }, { headers: { "cache-control": "private, no-store" } });
    }
    if (!process.env.DATABASE_URL) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 503, "媒体学习进度暂时无法同步。");
    }
    const progress = await saveMediaProgress(
      createDrizzleMediaRepository(getDatabase()),
      user.id,
      stableKey,
      parsed.data,
    );
    return NextResponse.json(
      { apiVersion: API_VERSION, data: { progress } },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof MediaProgressConflictError) {
      return errorResponse(requestId, "MEDIA_PROGRESS_CONFLICT", 409, "媒体学习进度已在其他位置更新，请重新加载。");
    }
    if (error instanceof MediaUnavailableError) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个媒体版本不存在或已撤下。");
    }
    if (error instanceof Error && error.message === "MEDIA_PROGRESS_INVALID") {
      return errorResponse(requestId, "VALIDATION_FAILED", 400, "媒体学习进度超出内容范围。");
    }
    return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 503, "媒体学习进度暂时无法同步。");
  }
}
