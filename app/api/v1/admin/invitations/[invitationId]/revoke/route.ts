import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  AccountActionError,
  createDrizzleAccountAdminRepository,
  revokeAccountInvitation,
  revokeInvitationRequestSchema,
} from "@/src/modules/account";
import { adminSuccess, withAdminOwner } from "@/src/modules/admin";

type Context = Readonly<{ params: Promise<{ invitationId: string }> }>;

/** POST /api/v1/admin/invitations/:invitationId/revoke (owner-only). */
export async function POST(
  request: NextRequest,
  context: Context,
): Promise<NextResponse> {
  return withAdminOwner(
    request,
    async ({ ownerId, requestId, database, auditRepository }) => {
      const { invitationId } = await context.params;
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
      const parsed = revokeInvitationRequestSchema.safeParse(body);
      if (!parsed.success) {
        throw new AccountActionError(
          "VALIDATION_FAILED",
          "A revocation reason between 4 and 500 characters is required.",
          400,
        );
      }
      const data = await revokeAccountInvitation(
        {
          repository: createDrizzleAccountAdminRepository(database),
          auditRepository,
        },
        {
          ownerId,
          requestId,
          invitationId,
          reason: parsed.data.reason,
        },
      );
      return adminSuccess(data, requestId);
    },
  );
}
