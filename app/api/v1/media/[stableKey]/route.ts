import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { createDrizzleMediaRepository, getMedia, mediaStableKeySchema } from "@/src/modules/media";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

type Context = Readonly<{ params: Promise<{ stableKey: string }> }>;

export async function GET(request: NextRequest, { params }: Context) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ apiVersion: API_VERSION, error: {
      code: "MEDIA_NOT_AVAILABLE", message: "媒体内容暂时不可用。", retryable: true, requestId,
    } }, { status: 503 });
  }
  let stableKey: string;
  try {
    stableKey = mediaStableKeySchema.parse(decodeURIComponent((await params).stableKey));
  } catch {
    return NextResponse.json({ apiVersion: API_VERSION, error: {
      code: "MEDIA_NOT_FOUND", message: "这个媒体内容不存在或已撤下。", retryable: false, requestId,
    } }, { status: 404 });
  }
  try {
    const user = (await verifyRequestUser(request))
      ?? (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
    const result = await getMedia(createDrizzleMediaRepository(getDatabase()), stableKey, user?.id);
    if (result.reason !== "found") {
      return NextResponse.json({ apiVersion: API_VERSION, error: {
        code: result.reason === "not_found" ? "MEDIA_NOT_FOUND" : "MEDIA_NOT_AVAILABLE",
        message: "这个媒体内容不存在或已撤下。",
        retryable: result.reason === "unavailable",
        requestId,
      } }, { status: 404 });
    }
    return NextResponse.json({ apiVersion: API_VERSION, data: result.media }, {
      headers: { "cache-control": user ? "private, no-store" : "public, max-age=60" },
    });
  } catch {
    return NextResponse.json({ apiVersion: API_VERSION, error: {
      code: "MEDIA_NOT_AVAILABLE", message: "媒体内容暂时不可用。", retryable: true, requestId,
    } }, { status: 503 });
  }
}
