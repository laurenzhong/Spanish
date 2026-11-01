import { createHash } from "node:crypto";

import type { AccountRole } from "./account-admin";

/**
 * Invite-only account invitation domain (ACCT-ADMIN-001, ADR-0021).
 *
 * Pure TypeScript: the only dependency is `node:crypto`'s deterministic
 * SHA-256, which is a pure function (no IO) and keeps this module testable and
 * portable. Random byte generation is injected from the application layer.
 *
 * The plaintext invitation code never leaves the server except once in the
 * create response; the database stores only its SHA-256 hash.
 */

/** `SN-INV-` + 3 groups of 4 Crockford Base32 characters = 60 bits of entropy. */
export const INVITATION_CODE_PREFIX = "SN-INV";
export const INVITATION_CODE_GROUP_LENGTH = 4;
export const INVITATION_CODE_GROUPS = 3;
export const INVITATION_CODE_BODY_LENGTH =
  INVITATION_CODE_GROUP_LENGTH * INVITATION_CODE_GROUPS;

/**
 * Crockford Base32: no I, L, O or U, so printed codes cannot be confused with
 * 1/0 or read as accidental words.
 */
export const INVITATION_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Canonical code shape: `SN-INV-XXXX-XXXX-XXXX` using the Crockford alphabet
 * (I, L, O and U excluded).
 */
export const INVITATION_CODE_PATTERN =
  /^SN-INV-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u;

export const INVITATION_STATUSES = [
  "pending",
  "redeeming",
  "accepted",
  "expired",
  "revoked",
  "failed",
] as const;

export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const INVITATION_ROLES = ["owner", "member"] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number] & AccountRole;

export const DEFAULT_INVITATION_TTL_HOURS = 168;
export const MIN_INVITATION_TTL_HOURS = 1;
export const MAX_INVITATION_TTL_HOURS = 720;

/**
 * A `redeeming` invitation left behind by a crashed redemption is reconciled to
 * `failed` after this window (handled by the owner console reconciliation; see
 * the ACCT-ADMIN-001 report).
 */
export const REDEEM_RECONCILIATION_WINDOW_MS = 15 * 60 * 1000;

export function isInvitationStatus(value: unknown): value is InvitationStatus {
  return INVITATION_STATUSES.some((status) => status === value);
}

/**
 * Turn 12 random bytes (one per code character) into a canonical code. Each
 * byte maps uniformly onto the 32-character alphabet because 256 % 32 === 0.
 */
export function generateInvitationCode(randomBytes: Uint8Array): string {
  if (randomBytes.length < INVITATION_CODE_BODY_LENGTH) {
    throw new Error("insufficient-invitation-entropy");
  }
  let body = "";
  for (let index = 0; index < INVITATION_CODE_BODY_LENGTH; index += 1) {
    body += INVITATION_CODE_ALPHABET[randomBytes[index]! % INVITATION_CODE_ALPHABET.length];
  }
  return formatInvitationCodeBody(body);
}

function formatInvitationCodeBody(body: string): string {
  const groups: string[] = [];
  for (let offset = 0; offset < body.length; offset += INVITATION_CODE_GROUP_LENGTH) {
    groups.push(body.slice(offset, offset + INVITATION_CODE_GROUP_LENGTH));
  }
  return `${INVITATION_CODE_PREFIX}-${groups.join("-")}`;
}

/**
 * Normalize user input into the canonical uppercase, dashed form. Accepts
 * copied codes with surrounding whitespace and missing dashes so the /join form
 * can stay forgiving, but the stored hash is always computed over the canonical
 * value.
 */
export function normalizeInvitationCode(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s-]+/gu, "");
  const prefix = INVITATION_CODE_PREFIX.replace("-", "");
  if (!compact.startsWith(prefix)) return null;
  const body = compact.slice(prefix.length);
  if (body.length !== INVITATION_CODE_BODY_LENGTH) return null;
  for (const character of body) {
    if (!INVITATION_CODE_ALPHABET.includes(character)) return null;
  }
  return formatInvitationCodeBody(body);
}

export function isValidInvitationCode(input: string): boolean {
  return normalizeInvitationCode(input) !== null;
}

/**
 * SHA-256 over the canonical code. The database CHECK constraint only accepts
 * 64 lowercase hex characters, which this digest always produces.
 */
export function hashInvitationCode(code: string): string {
  const normalized = normalizeInvitationCode(code);
  if (!normalized) throw new Error("invalid-invitation-code");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Canonical invitation email: trimmed, lowercase, basic shape validation. The
 * database CHECK enforces the same lowercase rule; this function fails closed on
 * anything Supabase would not accept as an email.
 */
export function normalizeInvitationEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (email.length < 3 || email.length > 320) return null;
  if (/\s/u.test(email)) return null;
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@")) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length === 0 || local.length > 64) return null;
  if (domain.length === 0 || domain.length > 255) return null;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return null;
  if (domain.includes("..")) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/u.test(local)) return null;
  if (!/^[a-z0-9.-]+$/u.test(domain)) return null;
  return email;
}

export function isValidInvitationEmail(input: string): boolean {
  return normalizeInvitationEmail(input) !== null;
}

/**
 * Masked email for owner-facing projections: `a***@example.com`. Plain email is
 * never returned to the browser after invitation creation.
 */
export function maskInvitationEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

export function invitationExpiresAt(now: Date, ttlHours: number): Date {
  if (
    !Number.isInteger(ttlHours) ||
    ttlHours < MIN_INVITATION_TTL_HOURS ||
    ttlHours > MAX_INVITATION_TTL_HOURS
  ) {
    throw new Error("invalid-invitation-ttl");
  }
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}

/** Parse the optional `ACCOUNT_INVITATION_TTL_HOURS` setting, fail-safe default. */
export function parseInvitationTtlHours(raw: string | undefined): number {
  const parsed = Number.parseInt((raw ?? "").trim(), 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_INVITATION_TTL_HOURS ||
    parsed > MAX_INVITATION_TTL_HOURS
  ) {
    return DEFAULT_INVITATION_TTL_HOURS;
  }
  return parsed;
}

export function isInvitationExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

const INVITATION_TRANSITIONS: Readonly<
  Record<InvitationStatus, readonly InvitationStatus[]>
> = {
  pending: ["redeeming", "revoked", "expired"],
  redeeming: ["accepted", "failed"],
  accepted: [],
  expired: [],
  revoked: [],
  failed: [],
};

export function canTransitionInvitation(
  from: InvitationStatus,
  to: InvitationStatus,
): boolean {
  return INVITATION_TRANSITIONS[from].some((status) => status === to);
}

export function assertInvitationTransition(
  from: InvitationStatus,
  to: InvitationStatus,
): void {
  if (!canTransitionInvitation(from, to)) {
    throw new Error(`invalid-invitation-transition:${from}->${to}`);
  }
}

/**
 * Effective status for reads: an unexpired `pending` row whose `expires_at` has
 * passed is shown (and lazily written) as `expired`. A stuck `redeeming` row is
 * kept as-is for the owner reconciliation job; it never becomes `pending`
 * again, so a concurrent second redemption still loses the CAS.
 */
export function resolveInvitationStatus(
  status: InvitationStatus,
  expiresAt: Date,
  now: Date,
): InvitationStatus {
  if (status === "pending" && isInvitationExpired(expiresAt, now)) {
    return "expired";
  }
  return status;
}

export type InvitationInvalidReason =
  | "not_found"
  | "expired"
  | "revoked"
  | "accepted"
  | "failed"
  | "in_progress"
  | "email_mismatch";

export type InvitationRedemptionDecision =
  | Readonly<{ kind: "redeemable" }>
  | Readonly<{ kind: "invalid"; reason: InvitationInvalidReason }>;

/**
 * Pre-check used for logging/diagnostics only. The authoritative concurrency
 * boundary is the repository's atomic `pending -> redeeming` CAS, which also
 * re-checks the email and expiry inside the single UPDATE.
 *
 * Every invalid reason maps to the same public `INVITATION_INVALID` response so
 * the public endpoint cannot be used to enumerate accounts or invitation states.
 */
export function evaluateInvitationRedemption(
  invitation: Readonly<{
    status: InvitationStatus;
    expiresAt: Date;
    email: string;
  }>,
  input: Readonly<{ email: string; now: Date }>,
): InvitationRedemptionDecision {
  const status = resolveInvitationStatus(
    invitation.status,
    invitation.expiresAt,
    input.now,
  );
  if (status === "accepted") return { kind: "invalid", reason: "accepted" };
  if (status === "revoked") return { kind: "invalid", reason: "revoked" };
  if (status === "failed") return { kind: "invalid", reason: "failed" };
  if (status === "expired") return { kind: "invalid", reason: "expired" };
  if (status === "redeeming") return { kind: "invalid", reason: "in_progress" };
  if (invitation.email !== input.email) {
    return { kind: "invalid", reason: "email_mismatch" };
  }
  return { kind: "redeemable" };
}
