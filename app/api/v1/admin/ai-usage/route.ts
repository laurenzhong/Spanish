import type { NextRequest } from "next/server";

import { readAdminAiUsage } from "@/src/modules/admin/application/read-admin-ai-usage";
import {
  adminSuccess,
  withAdminOwner,
} from "@/src/modules/admin/http/with-admin-owner";
import { createDrizzleAdminReadRepository } from "@/src/modules/admin/repositories/drizzle-admin-read-repository";
import { adminAiUsageQuerySchema } from "@/src/modules/admin/schemas/admin-console";

/** GET /api/v1/admin/ai-usage?from=&to=&providerType=&provider= */
export async function GET(request: NextRequest) {
  return withAdminOwner(request, async ({ database, requestId }) => {
    const query = adminAiUsageQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const repository = createDrizzleAdminReadRepository(database);
    return adminSuccess(
      await readAdminAiUsage(repository, query),
      requestId,
    );
  });
}
