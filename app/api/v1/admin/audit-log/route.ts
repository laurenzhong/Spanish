import type { NextRequest } from "next/server";

import { listAdminAuditLog } from "@/src/modules/admin/application/list-admin-audit-log";
import { adminPageSuccess } from "@/src/modules/admin/http/admin-page-response";
import { withAdminOwner } from "@/src/modules/admin/http/with-admin-owner";
import { createDrizzleAdminReadRepository } from "@/src/modules/admin/repositories/drizzle-admin-read-repository";
import { adminAuditLogQuerySchema } from "@/src/modules/admin/schemas/admin-console";

/** GET /api/v1/admin/audit-log?action=&targetKind=&cursor=&limit= */
export async function GET(request: NextRequest) {
  return withAdminOwner(request, async ({ database, requestId }) => {
    const query = adminAuditLogQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const repository = createDrizzleAdminReadRepository(database);
    const result = await listAdminAuditLog(repository, query);
    return adminPageSuccess(result.data, result.page, requestId);
  });
}
