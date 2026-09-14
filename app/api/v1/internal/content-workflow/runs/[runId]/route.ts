import type { NextRequest } from "next/server";

import { getAcquisitionRun } from "@/src/modules/content-acquisition";
import { withContentWorkflowOwner, workflowNotFound, workflowSuccess } from "../../http";
import { z } from "zod";

type Context = Readonly<{ params: Promise<{ runId: string }> }>;

export async function GET(request: NextRequest, context: Context) {
  return withContentWorkflowOwner(request, async ({ repository, ownerUserId, requestId }) => {
    const runId = z.uuid().parse((await context.params).runId);
    const run = await getAcquisitionRun(repository, ownerUserId, runId);
    return run ? workflowSuccess({ run }, requestId) : workflowNotFound(requestId, "Acquisition run");
  });
}
