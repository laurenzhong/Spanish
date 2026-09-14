import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type Context = Readonly<{ params: Promise<{ stableKey: string }> }>;
const YOUTUBE_ARTWORK = /^https:\/\/(?:img\.youtube\.com|i\.ytimg\.com)\/vi\/([A-Za-z0-9_-]{6,64})\/(?:mqdefault|hqdefault|maxresdefault)\.jpg$/u;

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
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 503, "媒体封面暂时不可用。");

  try {
    const { stableKey } = await params;
    const result = await createDrizzleMediaRepository(getDatabase()).findByStableKey(decodeURIComponent(stableKey), user.id);
    if (result.reason !== "found" || result.media.kind !== "video" || !result.media.artwork) {
      return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个视频封面不存在或已撤下。");
    }
    const match = YOUTUBE_ARTWORK.exec(result.media.artwork.url);
    if (!match) return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个视频封面来源不受支持。");
    const videoId = match[1];
    const sourceUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    const upstreamUrls = [
      `https://wsrv.nl/?url=${encodeURIComponent(sourceUrl)}`,
      sourceUrl,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    ];
    let upstream: Response | null = null;
    for (const url of upstreamUrls) {
      try {
        const candidate = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        const contentType = candidate.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
        const contentLength = Number(candidate.headers.get("content-length") ?? 0);
        if (candidate.ok && contentType.startsWith("image/") && (!contentLength || contentLength <= 2_000_000)) {
          upstream = candidate;
          break;
        }
      } catch {
        // Try the alternate official YouTube thumbnail host.
      }
    }
    if (!upstream?.body) return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 502, "视频封面暂时无法加载。");
    const body = await upstream.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > 2_000_000) return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 502, "视频封面暂时无法加载。");
    return new NextResponse(body, {
      status: 200,
      headers: {
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
        "content-type": upstream.headers.get("content-type")?.split(";", 1)[0] ?? "image/jpeg",
        "content-length": String(body.byteLength),
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return errorResponse(requestId, "MEDIA_NOT_AVAILABLE", 404, "这个视频封面不存在或已撤下。");
  }
}
