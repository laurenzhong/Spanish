import type { NextRequest } from "next/server";

import { updateDiagnosticStatus } from "@/src/modules/admin/application/update-diagnostic-status";
import {
  adminSuccess,
  withAdminOwner,
} from "@/src/modules/admin/http/with-admin-owner";
import { createDrizzleAdminReadRepository } from "@/src/modules/admin/repositories/drizzle-admin-read-repository";
import {
  adminDiagnosticEventParamsSchema,
  adminDiagnosticUpdateSchema,
} from "@/src/modules/admin/schemas/admin-console";

type Context = Readonly<{ params: Promise<{ eventId: string }> }>;

/**
 * PATCH /api/v1/admin/diagnostics/:eventId
 *
 * Body `{ status: "acknowledged"|"resolved", reason }`. The only write of the
 * regulatory-console slice; it records `diagnostic.acknowledge` /
 * `diagnostic.resolve` in the append-only audit log.
 */
export async function PATCH(request: NextRequest, context: Context) {
  return withAdminOwner(
    request,
    async ({ database, auditRepository, ownerId, requestId }) => {
      const { eventId } = adminDiagnosticEventParamsSchema.parse(
        await context.params,
      );
      const body = adminDiagnosticUpdateSchema.parse(await request.json());
      const repository = createDrizzleAdminReadRepository(database);
      return adminSuccess(
        await updateDiagnosticStatus(repository, auditRepository, {
          eventId,
          status: body.status,
          reason: body.reason,
          actorUserId: ownerId,
          requestId,
        }),
        requestId,
      );
    },
  );
}
