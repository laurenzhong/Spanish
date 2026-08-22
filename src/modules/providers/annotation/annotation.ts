import type { SpeechSignalObservation } from "../speech/speech-signal";

export const annotationErrorCodes = [
  "input-invalid",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
] as const;

export type AnnotationErrorCode = (typeof annotationErrorCodes)[number];
export type AnnotationLocale = "es-ES" | "es-MX";

export type AnnotationDraftInput = Readonly<{
  transcript: string;
  locale: AnnotationLocale;
  contentVersion: string;
  attemptId: string;
  generationId: number;
  speechSignal: SpeechSignalObservation | null;
}>;

export type AnnotationCategory =
  | "transcript"
  | "pronunciation"
  | "fluency"
  | "context";

export type AnnotationDraftObservation = Readonly<{
  category: AnnotationCategory;
  observation: string;
  evidenceBasis: "transcript" | "speech-signal" | "both";
  needsHumanReview: true;
}>;

export type AnnotationDraft = Readonly<{
  status: "draft";
  summary: string;
  observations: readonly AnnotationDraftObservation[];
  questionsForReviewer: readonly string[];
  safety: Readonly<{
    audioSent: false;
    writesEvidence: false;
    affectsMastery: false;
    affectsConfidence: false;
  }>;
  provider: "minimax" | "manual-codex" | "fake";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
  retentionPolicy: "ephemeral";
}>;

export interface AnnotationDraftProvider {
  createDraft(
    input: AnnotationDraftInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<AnnotationDraft>;
}

export class AnnotationDraftError extends Error {
  readonly code: AnnotationErrorCode;
  readonly retryable: boolean;

  constructor(
    code: AnnotationErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "AnnotationDraftError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function validateAnnotationDraftInput(
  input: AnnotationDraftInput,
): void {
  if (!input.transcript.trim() || !input.contentVersion.trim()) {
    throw new AnnotationDraftError(
      "input-invalid",
      "Annotation input is incomplete.",
      false,
    );
  }
  if (!Number.isInteger(input.generationId) || input.generationId < 0) {
    throw new AnnotationDraftError(
      "input-invalid",
      "Annotation generation is invalid.",
      false,
    );
  }
  if (!input.attemptId.trim()) {
    throw new AnnotationDraftError(
      "input-invalid",
      "Annotation attempt is invalid.",
      false,
    );
  }
}

