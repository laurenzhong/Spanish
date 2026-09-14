import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  ContentAcquisitionConflictError,
  ContentPublicationConflictError,
  ContentPublisherNotAvailableError,
  ContentReviewIncompleteError,
  createDrizzleContentAcquisitionRepository,
} from "@/src/modules/content-acquisition";
import { contentWorkflowPublishers } from "@/src/modules/content-acquisition/publishers/runtime-registry";
import { ContentWorkflowForbiddenError, isContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

export type ContentWorkflowRequestContext = Readonly<{
  ownerUserId: string;
  repository: ReturnType<typeof createDrizzleContentAcquisitionRepository>;
  publishers: typeof contentWorkflowPublishers;
  requestId: string;
}>;

function errorResponse(requestId: string, code: string, message: string, status: number, retryable = false) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, retryable, requestId } },
    { status, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
  );
}

async function authenticatedUser(request: NextRequest) {
  return (await verifyRequestUser(request)) ?? (request.cookies.getAll().length ? await getCurrentUser() : null);
}

export async function withContentWorkflowOwner(
  request: NextRequest,
  action: (context: ContentWorkflowRequestContext) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = await authenticatedUser(request);
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", "A valid user session is required.", 401);
  if (!isContentWorkflowOwner(user.id)) return errorResponse(requestId, "CONTENT_WORKFLOW_FORBIDDEN", "This workflow is restricted to its configured owner.", 403);
  if (!process.env.DATABASE_URL) return errorResponse(requestId, "INTERNAL_ERROR", "The content workflow database is unavailable.", 503, true);
  try {
    return await action({
      ownerUserId: user.id,
      repository: createDrizzleContentAcquisitionRepository(getDatabase()),
      publishers: contentWorkflowPublishers,
      requestId,
    });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return errorResponse(requestId, "VALIDATION_FAILED", "The request input is invalid.", 400);
    if (error instanceof ContentWorkflowForbiddenError) return errorResponse(requestId, error.code, error.message, 403);
    if (error instanceof ContentReviewIncompleteError) return errorResponse(requestId, error.code, error.message, 409);
    if (error instanceof ContentPublisherNotAvailableError) return errorResponse(requestId, error.code, error.message, 503, true);
    if (error instanceof ContentPublicationConflictError || error instanceof ContentAcquisitionConflictError) return errorResponse(requestId, "CONTENT_PUBLICATION_CONFLICT", error.message, 409);
    return errorResponse(requestId, "INTERNAL_ERROR", "The content workflow is temporarily unavailable.", 503, true);
  }
}

export function workflowSuccess(data: unknown, requestId: string, status = 200) {
  return NextResponse.json(
    { apiVersion: API_VERSION, data },
    { status, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
  );
}

export function workflowNotFound(requestId: string, resource: string) {
  return errorResponse(requestId, "RESOURCE_NOT_FOUND", `${resource} was not found.`, 404);
}
