import type { NextRequest } from "next/server";

import { listCandidates } from "@/src/modules/content-acquisition";
import { contentWorkflowCandidateQuerySchema } from "@/src/modules/content-acquisition/schemas";
import { withContentWorkflowOwner, workflowSuccess } from "../http";

export async function GET(request: NextRequest) {
  return withContentWorkflowOwner(request, async ({ repository, ownerUserId, requestId }) => {
    const query = contentWorkflowCandidateQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams.entries()));
    const candidates = await listCandidates(repository, { ownerUserId, ...query });
    return workflowSuccess({ candidates }, requestId);
  });
}
