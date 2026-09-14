import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  createDrizzleMediaRepository,
  getMediaPlayback,
  MediaUnavailableError,
} from "@/src/modules/media";
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

export async function GET(request: NextRequest, { params }: Context) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await requestUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) {
    return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 503, "媒体播放信息暂时不可用。");
  }

  try {
    const { stableKey } = await params;
    const playback = await getMediaPlayback(
      createDrizzleMediaRepository(getDatabase()),
      decodeURIComponent(stableKey),
      user.id,
    );
    return NextResponse.json(
      { apiVersion: API_VERSION, data: playback },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof MediaUnavailableError) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个媒体内容不存在、已撤下或播放地址已失效。");
    }
    return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个媒体内容不存在或已撤下。");
  }
}
