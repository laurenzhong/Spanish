import type { NextRequest } from "next/server";

import { readAdminOverview } from "@/src/modules/admin/application/read-admin-overview";
import {
  adminSuccess,
  withAdminOwner,
} from "@/src/modules/admin/http/with-admin-owner";
import { createDrizzleAdminReadRepository } from "@/src/modules/admin/repositories/drizzle-admin-read-repository";
import { adminOverviewQuerySchema } from "@/src/modules/admin/schemas/admin-console";

/** GET /api/v1/admin/overview?window=24h|7d|30d */
export async function GET(request: NextRequest) {
  return withAdminOwner(request, async ({ database, requestId }) => {
    const query = adminOverviewQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const repository = createDrizzleAdminReadRepository(database);
    return adminSuccess(
      await readAdminOverview(repository, { window: query.window }),
      requestId,
    );
  });
}
