import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  AccountActionError,
  createAccountInvitation,
  createDrizzleAccountAdminRepository,
  listAccountInvitations,
  listInvitationsQuerySchema,
  parseInvitationTtlHours,
  createInvitationRequestSchema,
} from "@/src/modules/account";
import {
  adminSuccess,
  withAdminOwner,
} from "@/src/modules/admin";

/**
 * Owner invitation management (ACCT-ADMIN-001 design §5.1).
 *
 * GET  /api/v1/admin/invitations?status=&limit=&cursor=  → masked summaries
 * POST /api/v1/admin/invitations                        → 201 invitation + one-time code
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return withAdminOwner(request, async ({ database, requestId }) => {
    const url = new URL(request.url);
    const parsed = listInvitationsQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    if (!parsed.success) {
      throw new AccountActionError(
        "VALIDATION_FAILED",
        "The invitation list query is invalid.",
        400,
      );
    }
    const data = await listAccountInvitations(
      { repository: createDrizzleAccountAdminRepository(database) },
      parsed.data,
    );
    return adminSuccess(data, requestId);
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withAdminOwner(request, async ({ ownerId, requestId, database, auditRepository }) => {
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
    const parsed = createInvitationRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AccountActionError(
        "VALIDATION_FAILED",
        "The request input is invalid.",
        400,
      );
    }
    const data = await createAccountInvitation(
      {
        repository: createDrizzleAccountAdminRepository(database),
        auditRepository,
        registrationEnabled: process.env.ACCOUNT_INVITATIONS_ENABLED === "1",
        defaultTtlHours: parseInvitationTtlHours(
          process.env.ACCOUNT_INVITATION_TTL_HOURS,
        ),
      },
      { ...parsed.data, ownerId, requestId },
    );
    return adminSuccess(data, requestId, 201);
  });
}
