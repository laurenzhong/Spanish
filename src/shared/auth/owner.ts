import { createHash } from "node:crypto";

import { z } from "zod";

import type { AccountAccess } from "./account-access";

/**
 * Owner (project-owner) authorization for the owner-only admin console and the
 * content workflow (ACCT-ADMIN-001, ADR-0021).
 *
 * The environment allowlist is the bootstrap root of trust: an owner account
 * can always be identified even if the database is unavailable. The database
 * `profiles.role = 'owner'` value is an additional, reviewable grant for future
 * collaborators. Neither value is ever read from the client.
 *
 * `OWNER_USER_IDS` is the primary variable. During the transition window the
 * existing `CONTENT_WORKFLOW_OWNER_USER_IDS` value is accepted as a fallback so
 * the local Alpha owner and the Playwright owner fixture keep working without a
 * second configuration step. Missing or malformed configuration fails closed.
 */
const ownerAllowlistSchema = z.array(z.uuid()).min(1);

function readOwnerIds(environment: NodeJS.ProcessEnv): ReadonlySet<string> {
  const raw = environment.OWNER_USER_IDS?.trim()
    ? environment.OWNER_USER_IDS
    : environment.CONTENT_WORKFLOW_OWNER_USER_IDS;
  if (!raw?.trim()) return new Set();
  const parsed = ownerAllowlistSchema.safeParse(
    raw.split(",").map((value) => value.trim()),
  );
  return parsed.success
    ? new Set(parsed.data.map((value) => value.toLowerCase()))
    : new Set();
}

/**
 * Configured environment owners (lowercase, validated). Server-only; used by the
 * admin console to show the effective role of bootstrap owners who deliberately
 * have no database `role='owner'` row.
 */
export function readConfiguredOwnerUserIds(
  environment: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  return [...readOwnerIds(environment)];
}

export function isOwnerUserId(
  userId: string,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const parsedUserId = z.uuid().safeParse(userId);
  return (
    parsedUserId.success &&
    readOwnerIds(environment).has(parsedUserId.data.toLowerCase())
  );
}

export type OwnerPrincipal = Readonly<{
  id: string;
  access: AccountAccess | null;
}>;

export function isOwnerPrincipal(
  principal: OwnerPrincipal,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isOwnerUserId(principal.id, environment) ||
    principal.access?.role === "owner"
  );
}

export class OwnerForbiddenError extends Error {
  readonly code = "ADMIN_FORBIDDEN" as const;

  constructor() {
    super("This area is restricted to the configured project owner.");
    this.name = "OwnerForbiddenError";
  }
}

export function assertOwnerPrincipal(
  principal: OwnerPrincipal,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (!isOwnerPrincipal(principal, environment)) throw new OwnerForbiddenError();
}

/**
 * Stable, non-reversible actor reference for ordinary logs and diagnostics.
 * The audit table itself stores the internal owner user id (server-only);
 * ordinary logs never need the raw id.
 */
export function ownerActorHash(userId: string): string {
  return createHash("sha256").update(`owner-audit:${userId}`).digest("hex").slice(0, 16);
}
