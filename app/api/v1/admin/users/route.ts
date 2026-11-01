import type { NextRequest } from "next/server";

import { listAdminUsers } from "@/src/modules/admin/application/list-admin-users";
import { adminPageSuccess } from "@/src/modules/admin/http/admin-page-response";
import { withAdminOwner } from "@/src/modules/admin/http/with-admin-owner";
import { createDrizzleAdminReadRepository } from "@/src/modules/admin/repositories/drizzle-admin-read-repository";
import { adminUsersQuerySchema } from "@/src/modules/admin/schemas/admin-console";

/** GET /api/v1/admin/users?q=&status=&role=&cursor=&limit= */
export async function GET(request: NextRequest) {
  return withAdminOwner(request, async ({ database, requestId }) => {
    const query = adminUsersQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const repository = createDrizzleAdminReadRepository(database);
    const result = await listAdminUsers(repository, query);
    return adminPageSuccess(result.data, result.page, requestId);
  });
}
