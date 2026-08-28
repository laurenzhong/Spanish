import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getAccountProfile, updateAccountProfile } from "@/src/modules/account";
import { initialsForDisplayName } from "@/src/modules/account/domain/avatar";
import { publicUidColorIndex } from "@/src/modules/account/domain/public-uid";
import { createDrizzleAccountRepository } from "@/src/modules/account/repositories";
import { createSupabaseAvatarStorage } from "@/src/modules/account/storage";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const AVATAR_PALETTE_SIZE = 5;

async function toDto(profile: NonNullable<Awaited<ReturnType<typeof getAccountProfile>>>) {
  const storage = profile.avatar.path ? createSupabaseAvatarStorage() : null;
  const url = profile.avatar.path && storage ? await storage.publicUrl(profile.avatar.path) : null;
  return {
    publicUid: profile.publicUid,
    displayName: profile.displayName,
    nativeLanguage: profile.nativeLanguage,
    interfaceLanguage: profile.interfaceLanguage,
    targetLanguage: profile.targetLanguage,
    updatedAt: profile.updatedAt.toISOString(),
    avatar: {
      kind: profile.avatar.kind,
      presetId: profile.avatar.presetId,
      url,
      initials: initialsForDisplayName(profile.displayName),
      colorIndex: publicUidColorIndex(profile.publicUid, AVATAR_PALETTE_SIZE),
    },
  };
}

async function authenticatedUser(request: NextRequest) {
  return (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
}

function errorResponse(requestId: string, code: string, message: string, status: number, retryable = false) {
  return NextResponse.json({ apiVersion: API_VERSION, error: { code, message, retryable, requestId } }, { status });
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await authenticatedUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", "A valid user session is required.", 401);
  try {
    const profile = await getAccountProfile(createDrizzleAccountRepository(getDatabase()), user.id);
    if (!profile) return errorResponse(requestId, "RESOURCE_NOT_FOUND", "Account profile was not found.", 404);
    return NextResponse.json({ apiVersion: API_VERSION, data: await toDto(profile) });
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", "Account data is temporarily unavailable.", 503, true);
  }
}

export async function PATCH(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await authenticatedUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", "A valid user session is required.", 401);
  try {
    const input = await request.json();
    const expectedHeader = request.headers.get("if-unmodified-since");
    const expectedUpdatedAt = expectedHeader ? new Date(expectedHeader) : undefined;
    const result = await updateAccountProfile(
      createDrizzleAccountRepository(getDatabase()),
      user.id,
      input,
      expectedUpdatedAt && !Number.isNaN(expectedUpdatedAt.valueOf()) ? expectedUpdatedAt : undefined,
    );
    if (result.kind === "conflict") return errorResponse(requestId, "CONFLICT", "Account data changed in another session.", 409);
    if (result.kind === "not-found" || !result.profile) return errorResponse(requestId, "RESOURCE_NOT_FOUND", "Account profile was not found.", 404);
    return NextResponse.json({ apiVersion: API_VERSION, data: await toDto(result.profile) });
  } catch (error) {
    if (error instanceof SyntaxError) return errorResponse(requestId, "VALIDATION_FAILED", "Request body must be valid JSON.", 400);
    if (error instanceof Error && error.message.startsWith("invalid-")) return errorResponse(requestId, "VALIDATION_FAILED", "Account profile input is invalid.", 400);
    return errorResponse(requestId, "INTERNAL_ERROR", "Account data is temporarily unavailable.", 503, true);
  }
}
