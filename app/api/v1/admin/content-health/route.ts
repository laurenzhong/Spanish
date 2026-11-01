import type { NextRequest } from "next/server";

import { readAdminContentHealth } from "@/src/modules/admin/application/read-admin-content-health";
import {
  adminSuccess,
  withAdminOwner,
} from "@/src/modules/admin/http/with-admin-owner";
import { createDrizzleAdminReadRepository } from "@/src/modules/admin/repositories/drizzle-admin-read-repository";
import { adminContentHealthQuerySchema } from "@/src/modules/admin/schemas/admin-console";

/** GET /api/v1/admin/content-health?window=24h|7d|30d */
export async function GET(request: NextRequest) {
  return withAdminOwner(request, async ({ database, requestId }) => {
    const query = adminContentHealthQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const repository = createDrizzleAdminReadRepository(database);
    return adminSuccess(
      await readAdminContentHealth(repository, { window: query.window }),
      requestId,
    );
  });
}
