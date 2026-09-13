import type { NextRequest } from "next/server";
import { z } from "zod";

import { getCandidateReview } from "@/src/modules/content-acquisition";
import { withContentWorkflowOwner, workflowNotFound, workflowSuccess } from "../../http";

type Context = Readonly<{ params: Promise<{ candidateId: string }> }>;

export async function GET(request: NextRequest, context: Context) {
  return withContentWorkflowOwner(request, async ({ repository, publishers, ownerUserId, requestId }) => {
    const candidateId = z.uuid().parse((await context.params).candidateId);
    const candidate = await getCandidateReview(repository, { ownerUserId, candidateId, publishers });
    return candidate ? workflowSuccess({ candidate }, requestId) : workflowNotFound(requestId, "Content candidate");
  });
}
