export type MediaProgressStatus = "in_progress" | "completed";

export type MediaProgress = Readonly<{
  lastPositionMs: number;
  lastSegmentIndex: number | null;
  status: MediaProgressStatus;
  revision: number;
}>;

export type SaveMediaProgressInput = Readonly<{
  expectedRevision: number;
  lastPositionMs: number;
  lastSegmentIndex: number | null;
  status: MediaProgressStatus;
}>;

export class MediaProgressConflictError extends Error {
  readonly code = "MEDIA_PROGRESS_CONFLICT" as const;

  constructor(message = "MEDIA_PROGRESS_CONFLICT") {
    super(message);
    this.name = "MediaProgressConflictError";
  }
}

function sameProgress(current: MediaProgress, input: SaveMediaProgressInput): boolean {
  return current.lastPositionMs === input.lastPositionMs
    && current.lastSegmentIndex === input.lastSegmentIndex
    && current.status === input.status;
}

export function nextMediaProgress(
  current: MediaProgress | null,
  input: SaveMediaProgressInput,
  durationMs: number,
): MediaProgress {
  if (!Number.isInteger(durationMs) || durationMs <= 0
    || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0
    || !Number.isInteger(input.lastPositionMs) || input.lastPositionMs < 0 || input.lastPositionMs > durationMs
    || (input.lastSegmentIndex !== null && (!Number.isInteger(input.lastSegmentIndex) || input.lastSegmentIndex < 0))) {
    throw new Error("MEDIA_PROGRESS_INVALID");
  }
  if (!current) {
    if (input.expectedRevision !== 0) throw new MediaProgressConflictError();
    return { lastPositionMs: input.lastPositionMs, lastSegmentIndex: input.lastSegmentIndex, status: input.status, revision: 1 };
  }
  if (input.expectedRevision !== current.revision) {
    if (input.expectedRevision < current.revision && sameProgress(current, input)) return current;
    throw new MediaProgressConflictError();
  }
  return { lastPositionMs: input.lastPositionMs, lastSegmentIndex: input.lastSegmentIndex, status: input.status, revision: current.revision + 1 };
}
