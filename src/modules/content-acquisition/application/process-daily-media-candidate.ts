import type { ContentMediaRuntime } from "./content-media-runtime";
import { processCandidate } from "./process-candidate";
import { processMediaCandidate } from "./process-media-candidate";
import { randomUUID } from "node:crypto";
import type { ContentAcquisitionRepository, ContentCandidateRecord, ContentWorkflowRepository } from "../repositories";

export async function processDailyMediaCandidate(input: Readonly<{
  repository: ContentAcquisitionRepository & Partial<Pick<ContentWorkflowRepository, "requestCandidateReprocessing">>;
  candidate: ContentCandidateRecord;
  runtime: ContentMediaRuntime;
  now?: () => Date;
  signal?: AbortSignal;
}>): Promise<ContentCandidateRecord> {
  let current = input.candidate;
  if (current.status === "review_ready" && input.repository.requestCandidateReprocessing) {
    current = await input.repository.requestCandidateReprocessing({
      candidateId: current.id,
      expectedRevision: current.revision,
      generationId: randomUUID(),
      updatedAt: (input.now ?? (() => new Date()))(),
    });
  }
  const events = {
    discovered: "screen-approved",
    screened: "start-acquisition",
    acquiring: "start-processing",
  } as const;
  while (current.status in events) {
    current = await processCandidate(input.repository, {
      candidateId: current.id,
      event: { type: events[current.status as keyof typeof events], expectedRevision: current.revision, generationId: current.generationId },
      now: input.now,
    });
  }
  if (current.status !== "processing") return current;
  const source = await (input.repository.findSourceById?.(current.sourceId) ?? input.repository.findSourceByStableKey(current.sourceId));
  if (!source) throw new Error("The media candidate source is missing.");
  return processMediaCandidate(input.repository, current.id, {
    transcriptionProvider: input.runtime.transcriptionProvider,
    translationProvider: input.runtime.translationProvider,
    artifactStore: input.runtime.createArtifactStore(current, source),
    policy: input.runtime.policy,
    now: input.now,
    signal: input.signal,
  });
}
