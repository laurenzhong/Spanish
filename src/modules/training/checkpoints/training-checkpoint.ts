import type {
  EvidenceStrength,
  TrainingError,
  TrainingEvaluation,
  TrainingOutputMode,
  TrainingState,
  TrainingStatus,
} from "../domain/training-state";

export const TRAINING_CHECKPOINT_SCHEMA_VERSION = 1;
export const TRAINING_CONTENT_BUNDLE_KEY = "alpha.core";
export const TRAINING_CONTENT_BUNDLE_VERSION = 1;

export const stableTrainingStatuses = [
  "awaiting-output",
  "showing-feedback",
  "completed",
  "recoverable-error",
] as const;

export type StableTrainingStatus = (typeof stableTrainingStatuses)[number];

export type TrainingCheckpoint = Readonly<{
  schemaVersion: number;
  contentBundleKey: string;
  contentBundleVersion: number;
  contentKey: string;
  goalKey: string;
  status: StableTrainingStatus;
  outputMode: TrainingOutputMode;
  hintLevel: 0 | 1 | 2 | 3;
  generationId: number;
  transcript: string | null;
  evaluation: TrainingEvaluation | null;
  error: TrainingError | null;
}>;

export type TrainingCheckpointStore = Readonly<{
  read(): Promise<string | null>;
  write(serialized: string): Promise<void>;
  clear(): Promise<void>;
}>;

export type TrainingCheckpointExpectation = Readonly<{
  contentBundleKey?: string;
  contentBundleVersion?: number;
}>;

export function isStableTrainingStatus(
  status: TrainingStatus,
): status is StableTrainingStatus {
  return stableTrainingStatuses.includes(status as StableTrainingStatus);
}

export function checkpointFromState(
  state: TrainingState,
  bundle: Readonly<{
    key?: string;
    version?: number;
  }> = {},
): TrainingCheckpoint | null {
  if (
    !isStableTrainingStatus(state.status) ||
    !state.contentKey ||
    !state.goalKey
  ) {
    return null;
  }

  return {
    schemaVersion: TRAINING_CHECKPOINT_SCHEMA_VERSION,
    contentBundleKey: bundle.key ?? TRAINING_CONTENT_BUNDLE_KEY,
    contentBundleVersion: bundle.version ?? TRAINING_CONTENT_BUNDLE_VERSION,
    contentKey: state.contentKey,
    goalKey: state.goalKey,
    status: state.status,
    outputMode: state.outputMode,
    hintLevel: state.hintLevel,
    generationId: state.generationId,
    transcript: state.transcript,
    evaluation: state.evaluation,
    error: state.error,
  };
}

export function serializeTrainingCheckpoint(
  checkpoint: TrainingCheckpoint,
): string {
  return JSON.stringify(checkpoint);
}

export function parseTrainingCheckpoint(
  serialized: string,
  expectation: TrainingCheckpointExpectation = {},
): TrainingCheckpoint | null {
  try {
    return checkpointFromUnknown(JSON.parse(serialized), expectation);
  } catch {
    return null;
  }
}

export function stateFromTrainingCheckpoint(
  checkpoint: TrainingCheckpoint,
): TrainingState {
  return {
    status: checkpoint.status,
    contentKey: checkpoint.contentKey,
    goalKey: checkpoint.goalKey,
    outputMode: checkpoint.outputMode,
    hintLevel: checkpoint.hintLevel,
    generationId: checkpoint.generationId,
    transcript: checkpoint.transcript,
    evaluation: checkpoint.evaluation,
    error: checkpoint.error,
  };
}

export async function restoreTrainingCheckpoint(
  store: TrainingCheckpointStore,
  expectation: TrainingCheckpointExpectation = {},
): Promise<TrainingState | null> {
  const serialized = await store.read();
  if (!serialized) return null;

  const checkpoint = parseTrainingCheckpoint(serialized, expectation);
  if (!checkpoint) {
    await store.clear();
    return null;
  }

  return stateFromTrainingCheckpoint(checkpoint);
}

function checkpointFromUnknown(
  input: unknown,
  expectation: TrainingCheckpointExpectation,
): TrainingCheckpoint | null {
  if (!isRecord(input)) return null;
  if (input.schemaVersion !== TRAINING_CHECKPOINT_SCHEMA_VERSION) return null;
  if (
    typeof input.contentBundleKey !== "string" ||
    typeof input.contentBundleVersion !== "number"
  ) {
    return null;
  }
  if (
    expectation.contentBundleKey !== undefined &&
    input.contentBundleKey !== expectation.contentBundleKey
  ) {
    return null;
  }
  if (
    expectation.contentBundleVersion !== undefined &&
    input.contentBundleVersion !== expectation.contentBundleVersion
  ) {
    return null;
  }
  if (
    !Number.isInteger(input.contentBundleVersion) ||
    input.contentBundleVersion < 1 ||
    typeof input.contentKey !== "string" ||
    !input.contentKey ||
    typeof input.goalKey !== "string" ||
    !input.goalKey
  ) {
    return null;
  }

  const status = input.status;
  const outputMode = input.outputMode;
  const hintLevel = input.hintLevel;
  const generationId = input.generationId;
  if (
    !isStableTrainingStatusValue(status) ||
    (outputMode !== "speech" && outputMode !== "typing") ||
    !isHintLevel(hintLevel) ||
    typeof generationId !== "number" ||
    !Number.isInteger(generationId) ||
    generationId < 0
  ) {
    return null;
  }

  const transcript = input.transcript;
  if (transcript !== null && typeof transcript !== "string") return null;

  const evaluation = parseEvaluation(input.evaluation);
  if (input.evaluation !== null && evaluation === null) return null;

  const error = parseError(input.error);
  if (input.error !== null && error === null) return null;
  if (status === "showing-feedback" && evaluation === null) return null;
  if (status === "recoverable-error" && error === null) return null;

  return {
    schemaVersion: TRAINING_CHECKPOINT_SCHEMA_VERSION,
    contentBundleKey: input.contentBundleKey,
    contentBundleVersion: input.contentBundleVersion,
    contentKey: input.contentKey,
    goalKey: input.goalKey,
    status,
    outputMode,
    hintLevel,
    generationId,
    transcript,
    evaluation,
    error,
  };
}

function parseEvaluation(input: unknown): TrainingEvaluation | null {
  if (input === null) return null;
  if (!isRecord(input)) return null;
  if (
    typeof input.contextualSuccess !== "boolean" ||
    !isEvidenceStrength(input.evidenceStrength) ||
    typeof input.feedbackKey !== "string" ||
    !input.feedbackKey
  ) {
    return null;
  }
  return {
    contextualSuccess: input.contextualSuccess,
    evidenceStrength: input.evidenceStrength,
    feedbackKey: input.feedbackKey,
  };
}

function parseError(input: unknown): TrainingError | null {
  if (input === null) return null;
  if (!isRecord(input)) return null;
  if (
    typeof input.code !== "string" ||
    !input.code ||
    typeof input.recoverTo !== "string" ||
    !isTrainingStatus(input.recoverTo) ||
    input.recoverTo === "loading-context" ||
    input.recoverTo === "recoverable-error" ||
    input.technical !== true
  ) {
    return null;
  }
  return {
    code: input.code,
    recoverTo: input.recoverTo,
    technical: true,
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function isHintLevel(input: unknown): input is 0 | 1 | 2 | 3 {
  return input === 0 || input === 1 || input === 2 || input === 3;
}

function isEvidenceStrength(input: unknown): input is EvidenceStrength {
  return (
    input === "none" ||
    input === "weak" ||
    input === "moderate" ||
    input === "strong"
  );
}

function isStableTrainingStatusValue(
  input: unknown,
): input is StableTrainingStatus {
  return typeof input === "string" && stableTrainingStatuses.includes(input as StableTrainingStatus);
}

function isTrainingStatus(input: string): input is TrainingStatus {
  return (
    input === "loading-context" ||
    input === "presenting-input" ||
    input === "awaiting-output" ||
    input === "recording" ||
    input === "transcribing" ||
    input === "evaluating" ||
    input === "showing-feedback" ||
    input === "transitioning" ||
    input === "completed" ||
    input === "recoverable-error"
  );
}
