import type { NextRequest } from "next/server";
import { z } from "zod";
import { publishPublishedMediaTranscript } from "@/src/modules/media/application";
import { withContentWorkflowOwner, workflowSuccess } from "../../../http";

export async function POST(request: NextRequest, context: Readonly<{ params: Promise<{ backfillId: string }> }>) {
  return withContentWorkflowOwner(request, async ({ mediaRepository, ownerUserId, requestId }) => {
    const backfillId = z.uuid().parse((await context.params).backfillId);
    return workflowSuccess({ publication: await publishPublishedMediaTranscript(mediaRepository, { ownerUserId, backfillId }) }, requestId);
  });
}
