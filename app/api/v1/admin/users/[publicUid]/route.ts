import type { NextRequest } from "next/server";

import { getAdminUserDetail } from "@/src/modules/admin/application/get-admin-user-detail";
import {
  adminSuccess,
  withAdminOwner,
} from "@/src/modules/admin/http/with-admin-owner";
import { createDrizzleAdminReadRepository } from "@/src/modules/admin/repositories/drizzle-admin-read-repository";
import { adminUserParamsSchema } from "@/src/modules/admin/schemas/admin-console";

type Context = Readonly<{ params: Promise<{ publicUid: string }> }>;

/**
 * GET /api/v1/admin/users/:publicUid
 *
 * Read-only detail. Account status/deletion routes belong to the account slice
 * (ACCT-ADMIN-001-A) and are intentionally not created here.
 */
export async function GET(request: NextRequest, context: Context) {
  return withAdminOwner(request, async ({ database, requestId }) => {
    const { publicUid } = adminUserParamsSchema.parse(await context.params);
    const repository = createDrizzleAdminReadRepository(database);
    return adminSuccess(
      await getAdminUserDetail(repository, { publicUid }),
      requestId,
    );
  });
}
