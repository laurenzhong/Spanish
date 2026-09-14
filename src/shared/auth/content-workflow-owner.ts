import { createHash } from "node:crypto";

import { z } from "zod";

const ownerAllowlistSchema = z.array(z.uuid()).min(1);

export class ContentWorkflowForbiddenError extends Error {
  readonly code = "CONTENT_WORKFLOW_FORBIDDEN" as const;

  constructor() {
    super("The current user is not allowed to access the content workflow.");
    this.name = "ContentWorkflowForbiddenError";
  }
}

function readOwnerIds(raw = process.env.CONTENT_WORKFLOW_OWNER_USER_IDS): ReadonlySet<string> {
  if (!raw?.trim()) return new Set();
  const parsed = ownerAllowlistSchema.safeParse(raw.split(",").map((value) => value.trim()));
  return parsed.success ? new Set(parsed.data.map((value) => value.toLowerCase())) : new Set();
}

export function isContentWorkflowOwner(userId: string, raw?: string): boolean {
  const parsedUserId = z.uuid().safeParse(userId);
  return parsedUserId.success && readOwnerIds(raw).has(parsedUserId.data.toLowerCase());
}

export function assertContentWorkflowOwner(userId: string, untrustedClaims?: unknown): void {
  void untrustedClaims;
  if (!isContentWorkflowOwner(userId)) throw new ContentWorkflowForbiddenError();
}

export function contentWorkflowActorHash(userId: string): string {
  return createHash("sha256").update(`content-workflow:${userId}`).digest("hex").slice(0, 16);
}
