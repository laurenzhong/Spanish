import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { deleteAvatar, getAccountProfile, uploadAvatar } from "@/src/modules/account";
import { initialsForDisplayName } from "@/src/modules/account/domain/avatar";
import { publicUidColorIndex } from "@/src/modules/account/domain/public-uid";
import { createDrizzleAccountRepository } from "@/src/modules/account/repositories";
import { createSupabaseAvatarStorage } from "@/src/modules/account/storage";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

function errorResponse(requestId: string, code: string, message: string, status: number, retryable = false) {
  return NextResponse.json({ apiVersion: API_VERSION, error: { code, message, retryable, requestId } }, { status });
}

async function authenticatedUser(request: NextRequest) {
  return getRequestUser(request, { verifyRequestUser, getCurrentUser });
}

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
    avatar: { kind: profile.avatar.kind, presetId: profile.avatar.presetId, url, initials: initialsForDisplayName(profile.displayName), colorIndex: publicUidColorIndex(profile.publicUid, 5) },
  };
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await authenticatedUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", "A valid user session is required.", 401);
  const storage = createSupabaseAvatarStorage();
  if (!storage) return errorResponse(requestId, "INTERNAL_ERROR", "头像存储尚未配置。", 503, true);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return errorResponse(requestId, "VALIDATION_FAILED", "请选择一张图片。", 400);
    if (!file.type.startsWith("image/")) return errorResponse(requestId, "VALIDATION_FAILED", "头像必须是图片文件。", 400);
    const result = await uploadAvatar(createDrizzleAccountRepository(getDatabase()), storage, user.id, new Uint8Array(await file.arrayBuffer()), file.type, form.get("attemptId")?.toString() ?? randomUUID());
    if (result.kind === "not-found") return errorResponse(requestId, "RESOURCE_NOT_FOUND", "Account profile was not found.", 404);
    if (result.kind === "conflict" || !result.profile) return errorResponse(requestId, "CONFLICT", "Account data changed in another session.", 409);
    return NextResponse.json({ apiVersion: API_VERSION, data: await toDto(result.profile) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "avatar-too-large") return errorResponse(requestId, "VALIDATION_FAILED", "头像文件不能超过 8 MB。", 400);
    return errorResponse(requestId, "INTERNAL_ERROR", "头像保存失败，请稍后重试。", 503, true);
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await authenticatedUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", "A valid user session is required.", 401);
  const storage = createSupabaseAvatarStorage();
  if (!storage) return errorResponse(requestId, "INTERNAL_ERROR", "头像存储尚未配置。", 503, true);
  try {
    const result = await deleteAvatar(createDrizzleAccountRepository(getDatabase()), storage, user.id);
    if (result.kind === "not-found") return errorResponse(requestId, "RESOURCE_NOT_FOUND", "Account profile was not found.", 404);
    if (result.kind === "conflict" || !result.profile) return errorResponse(requestId, "CONFLICT", "Account data changed in another session.", 409);
    return NextResponse.json({ apiVersion: API_VERSION, data: await toDto(result.profile) });
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", "头像删除失败，请稍后重试。", 503, true);
  }
}
