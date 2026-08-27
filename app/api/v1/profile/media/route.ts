import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteSavedAudio,
  deleteSavedTranscript,
  listSavedAudio,
  listSavedTranscripts,
} from "@/src/modules/privacy";
import { createDrizzlePrivacyRepository } from "@/src/modules/privacy/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const mediaKindSchema = z.enum(["audio", "transcript"]);
const mediaIdSchema = z.string().uuid();

function errorResponse(
  requestId: string,
  code: ApiErrorCode,
  status: number,
  message: string,
): NextResponse {
  return NextResponse.json(
    {
      apiVersion: API_VERSION,
      error: { code, message, requestId, retryable: status >= 500 },
    },
    { status },
  );
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) {
    return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  }

  try {
    const repository = process.env.DATABASE_URL
      ? createDrizzlePrivacyRepository(getDatabase())
      : null;
    const [audio, transcripts] = repository
      ? await Promise.all([
          listSavedAudio(repository, user.id),
          listSavedTranscripts(repository, user.id),
        ])
      : [[], []];
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        data: {
          audio: audio.map((item) => ({
            createdAt: item.createdAt.toISOString(),
            durationMs: item.durationMs,
            id: item.id,
            mimeType: item.mimeType,
            purpose: item.purpose,
            retentionPolicy: item.retentionPolicy,
            sizeBytes: item.sizeBytes,
          })),
          transcripts: transcripts.map((item) => ({
            attemptId: item.attemptId,
            createdAt: item.createdAt.toISOString(),
            text: item.text,
          })),
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Saved voice data is temporarily unavailable.");
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) {
    return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  }

  const kind = mediaKindSchema.safeParse(request.nextUrl.searchParams.get("kind"));
  const id = mediaIdSchema.safeParse(request.nextUrl.searchParams.get("id"));
  if (!kind.success || !id.success) {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "A valid media kind and ID are required.");
  }
  if (!process.env.DATABASE_URL) {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Saved voice data is temporarily unavailable.");
  }

  try {
    const repository = createDrizzlePrivacyRepository(getDatabase());
    const deleted = kind.data === "audio"
      ? await deleteSavedAudio(repository, user.id, id.data)
      : await deleteSavedTranscript(repository, user.id, id.data);
    return NextResponse.json(
      { apiVersion: API_VERSION, data: { deleted, kind: kind.data, id: id.data } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Saved voice data is temporarily unavailable.");
  }
}
