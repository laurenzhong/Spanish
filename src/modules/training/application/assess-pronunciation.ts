import {
  PronunciationAssessmentError,
  type PronunciationAssessmentInput,
  type PronunciationAssessmentResult,
  type PronunciationErrorCode,
  type PronunciationProvider,
  validatePronunciationInput,
} from "@/src/modules/providers/pronunciation";

export type PronunciationAssessmentMode = "sampled" | "explicit-review" | "typing";

export type AssessPronunciationAttemptInput = Readonly<
  Omit<PronunciationAssessmentInput, "attemptId" | "generationId"> & {
    attemptId: string;
    generationId: number;
    currentGenerationId: number;
    outputMode: "speech" | "typing";
    assessmentMode: PronunciationAssessmentMode;
  }
>;

export type PronunciationObservation = Readonly<{
  attemptId: string;
  generationId: number;
  provider: PronunciationAssessmentResult["provider"];
  modelVersion: string;
  pronunciationScore: number;
  fluencyScore: number;
  prosodyScore: number | null;
  completenessScore: number | null;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
  retentionPolicy: "ephemeral";
  disposition: "observation-only";
}>;

export type PronunciationAssessmentApplicationResult =
  | Readonly<{
      status: "observed";
      attemptId: string;
      generationId: number;
      quality: "usable";
      observation: PronunciationObservation;
    }>
  | Readonly<{
      status: "pending-verification";
      attemptId: string;
      generationId: number;
      quality: "insufficient";
      provider: PronunciationAssessmentResult["provider"] | null;
      modelVersion: string | null;
      providerRequestId: string | null;
      latencyMs: number | null;
      disposition: "no-negative-evidence";
    }>
  | Readonly<{
      status: "recoverable-error";
      attemptId: string;
      generationId: number;
      code: PronunciationErrorCode;
      retryable: boolean;
      disposition: "no-negative-evidence";
    }>
  | Readonly<{
      status: "stale";
      attemptId: string;
      generationId: number;
      currentGenerationId: number;
      disposition: "ignored-stale-result";
    }>;

export class PronunciationApplicationError extends Error {
  readonly code = "pronunciation-not-eligible" as const;

  constructor(message: string) {
    super(message);
    this.name = "PronunciationApplicationError";
  }
}

export async function assessPronunciationAttempt(
  provider: PronunciationProvider,
  input: AssessPronunciationAttemptInput,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<PronunciationAssessmentApplicationResult> {
  if (input.generationId !== input.currentGenerationId) {
    return {
      status: "stale",
      attemptId: input.attemptId,
      generationId: input.generationId,
      currentGenerationId: input.currentGenerationId,
      disposition: "ignored-stale-result",
    };
  }

  if (input.outputMode !== "speech") {
    throw new PronunciationApplicationError(
      "Pronunciation assessment is available only for spoken output.",
    );
  }
  if (input.assessmentMode !== "sampled" && input.assessmentMode !== "explicit-review") {
    throw new PronunciationApplicationError(
      "Pronunciation assessment requires a sampled or explicit review attempt.",
    );
  }

  const providerInput: PronunciationAssessmentInput = {
    audioBytes: input.audioBytes,
    mimeType: input.mimeType,
    fileName: input.fileName,
    locale: input.locale,
    referenceText: input.referenceText,
    attemptId: input.attemptId,
    generationId: input.generationId,
  };
  validatePronunciationInput(providerInput);

  try {
    const result = await provider.assess(providerInput, options);
    return mapProviderResult(providerInput, result);
  } catch (error) {
    if (!(error instanceof PronunciationAssessmentError)) throw error;
    return {
      status: "recoverable-error",
      attemptId: input.attemptId,
      generationId: input.generationId,
      code: error.code,
      retryable: error.retryable,
      disposition: "no-negative-evidence",
    };
  }
}

function mapProviderResult(
  input: PronunciationAssessmentInput,
  result: PronunciationAssessmentResult,
): PronunciationAssessmentApplicationResult {
  if (
    result.quality === "insufficient" ||
    result.pronunciationScore === null ||
    result.fluencyScore === null
  ) {
    return {
      status: "pending-verification",
      attemptId: input.attemptId,
      generationId: input.generationId,
      quality: "insufficient",
      provider: result.provider,
      modelVersion: result.modelVersion,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
      disposition: "no-negative-evidence",
    };
  }

  return {
    status: "observed",
    attemptId: input.attemptId,
    generationId: input.generationId,
    quality: "usable",
    observation: {
      attemptId: input.attemptId,
      generationId: input.generationId,
      provider: result.provider,
      modelVersion: result.modelVersion,
      pronunciationScore: result.pronunciationScore,
      fluencyScore: result.fluencyScore,
      prosodyScore: result.prosodyScore,
      completenessScore: result.completenessScore,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
      estimatedCostMicros: result.estimatedCostMicros,
      retentionPolicy: result.retentionPolicy,
      disposition: "observation-only",
    },
  };
}
