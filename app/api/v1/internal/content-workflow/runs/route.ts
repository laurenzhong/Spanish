import type { NextRequest } from "next/server";
import { z } from "zod";

import { listAcquisitionRuns } from "@/src/modules/content-acquisition";
import { withContentWorkflowOwner, workflowSuccess } from "../http";

export async function GET(request: NextRequest) {
  return withContentWorkflowOwner(request, async ({ repository, ownerUserId, requestId }) => {
    const rawSourceId = request.nextUrl.searchParams.get("sourceId");
    const sourceId = rawSourceId ? z.uuid().parse(rawSourceId) : undefined;
    return workflowSuccess({ runs: await listAcquisitionRuns(repository, { ownerUserId, sourceId }) }, requestId);
  });
}
