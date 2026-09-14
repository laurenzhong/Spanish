export const candidateStatuses = [
  "discovered",
  "screened",
  "acquiring",
  "processing",
  "review_ready",
  "failed",
  "rejected",
] as const;

export type CandidateStatus = (typeof candidateStatuses)[number];

export type CandidateState = Readonly<{
  status: CandidateStatus;
  revision: number;
  generationId: string;
}>;

type CandidateStateEventType =
  | "screen-approved"
  | "start-acquisition"
  | "start-processing"
  | "mark-review-ready"
  | "fail"
  | "retry"
  | "reject";

export type CandidateStateEvent = Readonly<{
  type: CandidateStateEventType;
  expectedRevision: number;
  generationId: string;
}>;

export class ContentAcquisitionConflictError extends Error {
  readonly code = "CONTENT_ACQUISITION_CONFLICT" as const;

  constructor(message = "The content acquisition state is stale or conflicts with current data.") {
    super(message);
    this.name = "ContentAcquisitionConflictError";
  }
}

export class InvalidAcquisitionTransitionError extends Error {
  readonly code = "CONTENT_PROCESSING_FAILED" as const;

  constructor(from: CandidateStatus, event: CandidateStateEventType) {
    super(`Content candidate cannot apply ${event} from ${from}.`);
    this.name = "InvalidAcquisitionTransitionError";
  }
}

const nextStatusByEvent: Readonly<
  Partial<Record<CandidateStatus, Partial<Record<CandidateStateEventType, CandidateStatus>>>>
> = {
  discovered: { "screen-approved": "screened", fail: "failed" },
  screened: { "start-acquisition": "acquiring", fail: "failed" },
  acquiring: { "start-processing": "processing", fail: "failed" },
  processing: { "mark-review-ready": "review_ready", fail: "failed" },
  review_ready: { reject: "rejected" },
  failed: { retry: "discovered" },
};

export function transitionCandidateState(
  current: CandidateState,
  event: CandidateStateEvent,
): CandidateState {
  if (!Number.isInteger(current.revision) || current.revision < 1) {
    throw new ContentAcquisitionConflictError("Candidate revision must be a positive integer.");
  }
  if (event.expectedRevision !== current.revision) {
    throw new ContentAcquisitionConflictError("Candidate revision no longer matches.");
  }

  if (event.type === "retry") {
    if (!event.generationId || event.generationId === current.generationId) {
      throw new ContentAcquisitionConflictError("A retry requires a new generation id.");
    }
  } else if (event.generationId !== current.generationId) {
    throw new ContentAcquisitionConflictError("A callback from an old generation cannot update the candidate.");
  }

  const nextStatus = nextStatusByEvent[current.status]?.[event.type];
  if (!nextStatus) {
    throw new InvalidAcquisitionTransitionError(current.status, event.type);
  }

  return {
    status: nextStatus,
    revision: current.revision + 1,
    generationId: event.type === "retry" ? event.generationId : current.generationId,
  };
}
