import type { NextRequest } from "next/server";

import { listAdminDiagnostics } from "@/src/modules/admin/application/list-admin-diagnostics";
import { adminPageSuccess } from "@/src/modules/admin/http/admin-page-response";
import { withAdminOwner } from "@/src/modules/admin/http/with-admin-owner";
import { createDrizzleAdminReadRepository } from "@/src/modules/admin/repositories/drizzle-admin-read-repository";
import { adminDiagnosticsQuerySchema } from "@/src/modules/admin/schemas/admin-console";

/** GET /api/v1/admin/diagnostics?status=&severity=&eventType=&since=&cursor=&limit= */
export async function GET(request: NextRequest) {
  return withAdminOwner(request, async ({ database, requestId }) => {
    const query = adminDiagnosticsQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const repository = createDrizzleAdminReadRepository(database);
    const result = await listAdminDiagnostics(repository, query);
    return adminPageSuccess(result.data, result.page, requestId);
  });
}
