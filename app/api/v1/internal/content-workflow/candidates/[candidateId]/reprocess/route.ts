import type { NextRequest } from "next/server";
import { z } from "zod";

import { requestCandidateReprocessing } from "@/src/modules/content-acquisition";
import { reprocessCandidateSchema } from "@/src/modules/content-acquisition/schemas";
import { withContentWorkflowOwner, workflowSuccess } from "../../../http";

type Context = Readonly<{ params: Promise<{ candidateId: string }> }>;

export async function POST(request: NextRequest, context: Context) {
  return withContentWorkflowOwner(request, async ({ repository, ownerUserId, requestId }) => {
    const candidateId = z.uuid().parse((await context.params).candidateId);
    const input = reprocessCandidateSchema.parse(await request.json());
    return workflowSuccess({ candidate: await requestCandidateReprocessing(repository, { ownerUserId, candidateId, ...input }) }, requestId);
  });
}
