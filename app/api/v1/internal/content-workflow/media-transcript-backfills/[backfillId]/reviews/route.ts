import type { NextRequest } from "next/server";
import { z } from "zod";
import { reviewPublishedMediaTranscript } from "@/src/modules/media/application";
import { withContentWorkflowOwner, workflowSuccess } from "../../../http";

const inputSchema = z.strictObject({
  dimension: z.enum(["content-es-ES", "teaching-zh-CN", "structure"]),
  status: z.enum(["approved", "changes_requested", "rejected"]),
  notes: z.string().trim().max(4_000).nullable(),
});

export async function POST(request: NextRequest, context: Readonly<{ params: Promise<{ backfillId: string }> }>) {
  return withContentWorkflowOwner(request, async ({ mediaRepository, ownerUserId, requestId }) => {
    const backfillId = z.uuid().parse((await context.params).backfillId);
    const input = inputSchema.parse(await request.json());
    return workflowSuccess({ backfill: await reviewPublishedMediaTranscript(mediaRepository, { ownerUserId, backfillId, ...input }) }, requestId);
  });
}
