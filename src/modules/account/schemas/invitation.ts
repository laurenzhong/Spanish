import { z } from "zod";

import {
  INVITATION_STATUSES,
  isValidInvitationEmail,
  MAX_INVITATION_TTL_HOURS,
  MIN_INVITATION_TTL_HOURS,
} from "../domain/invitation";

/**
 * Request/response DTOs for the invite-only account flow (ACCT-ADMIN-001).
 * These Zod schemas are the single source for the account invitation API; the
 * matching `contracts/schemas/v1/account-invitation-*.schema.json` files repeat
 * the validated shape for the versioned contract.
 *
 * Plain email is accepted as *input* but never returned after creation: list and
 * revoke responses only carry `emailMasked`.
 */

export const invitationEmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .refine((value) => isValidInvitationEmail(value), {
    message: "invalid-invitation-email",
  });

export const invitationRoleSchema = z.enum(["member", "owner"]);

export const redeemInvitationRequestSchema = z.strictObject({
  code: z.string().trim().min(1).max(64),
  email: invitationEmailSchema,
});

export const createInvitationRequestSchema = z.strictObject({
  email: invitationEmailSchema,
  role: invitationRoleSchema.optional(),
  expiresInHours: z
    .number()
    .int()
    .min(MIN_INVITATION_TTL_HOURS)
    .max(MAX_INVITATION_TTL_HOURS)
    .optional(),
  notes: z.string().trim().max(500).optional(),
});

export const revokeInvitationRequestSchema = z.strictObject({
  reason: z.string().trim().min(4).max(500),
});

export const listInvitationsQuerySchema = z.strictObject({
  status: z.enum(INVITATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).max(512).optional(),
});

export type RedeemInvitationRequest = z.infer<typeof redeemInvitationRequestSchema>;
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;
export type RevokeInvitationRequest = z.infer<typeof revokeInvitationRequestSchema>;
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;

export type InvitationSummaryDto = Readonly<{
  id: string;
  emailMasked: string;
  role: "member" | "owner";
  status: (typeof INVITATION_STATUSES)[number];
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  failureCode: string | null;
}>;

export type InvitationListDto = Readonly<{
  invitations: readonly InvitationSummaryDto[];
  page: Readonly<{ nextCursor: string | null; hasMore: boolean }>;
}>;

export type RedeemInvitationResponseDto = Readonly<{
  status: "ready";
  email: string;
}>;

export type CreateInvitationResponseDto = Readonly<{
  invitation: InvitationSummaryDto;
  /** Returned exactly once at creation; only the SHA-256 hash is stored. */
  code: string;
}>;

export type RevokeInvitationResponseDto = Readonly<{
  invitation: InvitationSummaryDto;
}>;
