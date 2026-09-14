import type { NextRequest } from "next/server";
import { z } from "zod";

import { submitCandidateReview } from "@/src/modules/content-acquisition";
import { submitCandidateReviewSchema } from "@/src/modules/content-acquisition/schemas";
import { withContentWorkflowOwner, workflowSuccess } from "../../../http";

type Context = Readonly<{ params: Promise<{ candidateId: string }> }>;

export async function POST(request: NextRequest, context: Context) {
  return withContentWorkflowOwner(request, async ({ repository, ownerUserId, requestId }) => {
    const candidateId = z.uuid().parse((await context.params).candidateId);
    const review = submitCandidateReviewSchema.parse(await request.json());
    return workflowSuccess({ review: await submitCandidateReview(repository, { ownerUserId, candidateId, review }) }, requestId);
  });
}
