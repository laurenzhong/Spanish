import type { NextRequest } from "next/server";

import { listAcquisitionSources } from "@/src/modules/content-acquisition";
import { withContentWorkflowOwner, workflowSuccess } from "../http";

export async function GET(request: NextRequest) {
  return withContentWorkflowOwner(request, async ({ repository, ownerUserId, requestId }) =>
    workflowSuccess({ sources: await listAcquisitionSources(repository, ownerUserId) }, requestId));
}
