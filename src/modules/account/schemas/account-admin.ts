import { z } from "zod";

import { isPublicUid } from "../domain/public-uid";
import {
  ACCOUNT_REASON_MAX_LENGTH,
  ACCOUNT_REASON_MIN_LENGTH,
  ACCOUNT_STATUSES,
  SELF_ACCOUNT_DELETION_CONFIRMATION,
} from "../domain/account-admin";

/** Account status / deletion DTOs for the owner console (ACCT-ADMIN-001). */

export const accountReasonSchema = z
  .string()
  .trim()
  .min(ACCOUNT_REASON_MIN_LENGTH)
  .max(ACCOUNT_REASON_MAX_LENGTH);

export const publicUidSchema = z
  .string()
  .trim()
  .refine((value) => isPublicUid(value), { message: "invalid-public-uid" });

export const patchAccountStatusRequestSchema = z.strictObject({
  status: z.enum(ACCOUNT_STATUSES),
  reason: accountReasonSchema,
});

export const selfAccountDeletionRequestSchema = z.strictObject({
  confirmation: z.literal(SELF_ACCOUNT_DELETION_CONFIRMATION),
});

export const ownerAccountDeletionRequestSchema = z.strictObject({
  confirmation: z.string().trim().min(1).max(64),
  reason: accountReasonSchema,
});

export const idempotencyKeySchema = z.string().trim().min(8).max(128);

export type PatchAccountStatusRequest = z.infer<typeof patchAccountStatusRequestSchema>;
export type OwnerAccountDeletionRequest = z.infer<
  typeof ownerAccountDeletionRequestSchema
>;

export type AdminUserSummaryDto = Readonly<{
  publicUid: string;
  displayName: string | null;
  role: "owner" | "member";
  accountStatus: "active" | "suspended";
  /** ISO timestamp while a deletion is in flight or was interrupted. */
  deletionRequestedAt: string | null;
  createdAt: string;
}>;

export type AccountStatusResponseDto = Readonly<{
  user: AdminUserSummaryDto;
}>;

export type AccountDeletionResponseDto = Readonly<{
  deleted: true;
  alreadyDeleted: boolean;
}>;
