import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getMediaPlayback } from "@/src/modules/media/application";
import { MediaUnavailableError } from "@/src/modules/media/domain";
import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type Context = Readonly<{ params: Promise<{ stableKey: string }> }>;

const RTVE_HOSTS = new Set(["ztnr.rtve.es", "rtve-mediavod-lote3.rtve.es"]);

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

function validRange(value: string | null): string {
  return value && /^bytes=\d+-\d*$/u.test(value) ? value : "bytes=0-";
}

export async function GET(request: NextRequest, { params }: Context) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await requestUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 503, "媒体播放信息暂时不可用。");

  try {
    const playback = await getMediaPlayback(
      createDrizzleMediaRepository(getDatabase()),
      decodeURIComponent((await params).stableKey),
      user.id,
    );
    if (playback.media.kind !== "podcast" || playback.asset.kind !== "audio") {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个媒体不支持音频流播放。");
    }
    const upstreamUrl = new URL(playback.asset.url);
    if (upstreamUrl.protocol !== "https:" || !RTVE_HOSTS.has(upstreamUrl.hostname.toLowerCase())) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个媒体不支持音频流播放。");
    }
    const upstream = await fetch(upstreamUrl, {
      headers: { range: validRange(request.headers.get("range")) },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!upstream.ok || !upstream.body) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 502, "播客音频暂时无法播放，请稍后重试。");
    }
    const headers = new Headers({
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "content-type": upstream.headers.get("content-type")?.split(";", 1)[0] ?? "audio/mpeg",
      "x-content-type-options": "nosniff",
    });
    for (const name of ["content-length", "content-range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof MediaUnavailableError) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个媒体内容不存在、已撤下或播放地址已失效。");
    }
    return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 502, "播客音频暂时无法播放，请稍后重试。");
  }
}
