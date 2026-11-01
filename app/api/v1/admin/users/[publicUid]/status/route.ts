import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  AccountActionError,
  createDrizzleAccountAdminRepository,
  createSupabaseAccountProvisioner,
  isPublicUid,
  patchAccountStatusRequestSchema,
  setAccountStatus,
} from "@/src/modules/account";
import { adminSuccess, withAdminOwner } from "@/src/modules/admin";

type Context = Readonly<{ params: Promise<{ publicUid: string }> }>;

/**
 * PATCH /api/v1/admin/users/:publicUid/status (owner-only).
 *
 * Body: `{ status: "active" | "suspended", reason }`. The application writes the
 * database state first for suspension (immediate gate block) and is idempotent
 * for retries after a Supabase failure.
 */
export async function PATCH(
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
      const parsed = patchAccountStatusRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw new AccountActionError(
          "VALIDATION_FAILED",
          "A status and a reason between 4 and 500 characters are required.",
          400,
        );
      }
      const data = await setAccountStatus(
        {
          repository: createDrizzleAccountAdminRepository(database),
          auditRepository,
          provisioner: createSupabaseAccountProvisioner(),
        },
        {
          ownerId,
          requestId,
          publicUid,
          status: parsed.data.status,
          reason: parsed.data.reason,
        },
      );
      return adminSuccess(data, requestId);
    },
  );
}
