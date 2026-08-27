import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  listAllRelationshipMemories,
} from "@/src/modules/memory";
import { createDrizzleMemoryRepository } from "@/src/modules/memory/repositories";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION, type ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const memoryRecordSchema = z.object({
  category: z.string().min(1),
  characterKey: z.string().min(1),
  content: z.string().min(1),
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
  sensitivity: z.enum(["normal", "sensitive"]),
  shareScope: z.enum(["private", "explicit"]),
  status: z.enum(["candidate", "confirmed", "rejected", "conflict"]),
});

const memoryIdSchema = z.string().uuid();

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

function serializeMemory(memory: Awaited<ReturnType<typeof listAllRelationshipMemories>>[number]) {
  return memoryRecordSchema.parse({
    category: memory.category,
    characterKey: memory.characterKey,
    content: memory.content,
    createdAt: memory.createdAt.toISOString(),
    id: memory.id,
    sensitivity: memory.sensitivity,
    shareScope: memory.shareScope,
    status: memory.status,
  });
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) {
    return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  }

  try {
    const memories = process.env.DATABASE_URL
      ? await listAllRelationshipMemories(createDrizzleMemoryRepository(getDatabase()), user.id)
      : [];
    return NextResponse.json(
      { apiVersion: API_VERSION, data: { memories: memories.map(serializeMemory) } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Memory controls are temporarily unavailable.");
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ??
    (request.cookies.getAll().length > 0 ? await getCurrentUser() : null);
  if (!user) {
    return errorResponse(requestId, "AUTH_REQUIRED", 401, "A valid user session is required.");
  }

  const memoryId = memoryIdSchema.safeParse(request.nextUrl.searchParams.get("memoryId"));
  if (!memoryId.success) {
    return errorResponse(requestId, "VALIDATION_FAILED", 400, "A valid memory ID is required.");
  }
  if (!process.env.DATABASE_URL) {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Memory controls are temporarily unavailable.");
  }

  try {
    const deleted = await createDrizzleMemoryRepository(getDatabase()).deleteMemory(user.id, memoryId.data);
    return NextResponse.json(
      { apiVersion: API_VERSION, data: { deleted } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return errorResponse(requestId, "INTERNAL_ERROR", 503, "Memory controls are temporarily unavailable.");
  }
}
