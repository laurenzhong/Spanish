import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  AccountActionError,
  createDrizzleAccountAdminRepository,
  createSupabaseAccountProvisioner,
  deleteAccountAsOwner,
  idempotencyKeySchema,
  isPublicUid,
  ownerAccountDeletionRequestSchema,
} from "@/src/modules/account";
import { createDrizzleDiagnosticEventRepository } from "@/src/modules/observability";
import {
  createDrizzlePrivacyRepository,
  createSupabaseStorageObjectDeleter,
} from "@/src/modules/privacy";
import { adminSuccess, withAdminOwner } from "@/src/modules/admin";

type Context = Readonly<{ params: Promise<{ publicUid: string }> }>;

/**
 * POST /api/v1/admin/users/:publicUid/deletion (owner-only).
 *
 * Body: `{ confirmation: "DELETE <publicUid>", reason }` + `Idempotency-Key`.
 * The full deletion is shared with self-service deletion; a partial failure
 * keeps `deletion_requested_at` on the profile tombstone so an owner retry can
 * finish removing the Auth user.
 */
export async function POST(
  request: NextRequest,
  context: Context,
): Promise<NextResponse> {
  return withAdminOwner(
    request,
    async ({ ownerId, requestId, database, auditRepository }) => {
      const { publicUid } = await context.params;
      if (!isPublicUid(publicUid)) {
        throw new AccountActionError(
          "VALIDATION_FAILED",
          "The user public uid is invalid.",
          400,
        );
      }
      const idempotencyKey = idempotencyKeySchema.safeParse(
        request.headers.get("idempotency-key"),
      );
      if (!idempotencyKey.success) {
        throw new AccountActionError(
          "VALIDATION_FAILED",
          "Account deletion requires an Idempotency-Key header.",
          400,
        );
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AccountActionError(
          "VALIDATION_FAILED",
          "The request input is invalid.",
          400,
        );
      }
      const parsed = ownerAccountDeletionRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw new AccountActionError(
          "VALIDATION_FAILED",
          "A confirmation phrase and a reason between 4 and 500 characters are required.",
          400,
        );
      }

      const data = await deleteAccountAsOwner(
        {
          repository: createDrizzleAccountAdminRepository(database),
          auditRepository,
          privacyRepository: createDrizzlePrivacyRepository(database),
          storageDeleter: createSupabaseStorageObjectDeleter(),
          diagnostics: createDrizzleDiagnosticEventRepository(database),
          provisioner: createSupabaseAccountProvisioner(),
        },
        {
          ownerId,
          requestId,
          publicUid,
          confirmation: parsed.data.confirmation,
          reason: parsed.data.reason,
        },
      );
      return adminSuccess(data, requestId);
    },
  );
}
