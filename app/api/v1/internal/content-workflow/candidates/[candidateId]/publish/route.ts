import type { NextRequest } from "next/server";
import { z } from "zod";

import { publishCandidate } from "@/src/modules/content-acquisition";
import { publishCandidateSchema } from "@/src/modules/content-acquisition/schemas";
import { withContentWorkflowOwner, workflowSuccess } from "../../../http";

type Context = Readonly<{ params: Promise<{ candidateId: string }> }>;

export async function POST(request: NextRequest, context: Context) {
  return withContentWorkflowOwner(request, async ({ repository, publishers, ownerUserId, requestId }) => {
    const candidateId = z.uuid().parse((await context.params).candidateId);
    const input = publishCandidateSchema.parse(await request.json());
    return workflowSuccess(await publishCandidate(repository, publishers, { ownerUserId, candidateId, ...input }), requestId);
  });
}
