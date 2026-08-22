import {
  SpeechSignalError,
  type SpeechSignalAnalyzer,
  type SpeechSignalInput,
  type SpeechSignalObservation,
  type SpeechSignalErrorCode,
  validateSpeechSignalInput,
} from "@/src/modules/providers/speech";

export type AnalyzeSpeechSignalAttemptInput = Readonly<
  Omit<SpeechSignalInput, "attemptId" | "generationId"> & {
    attemptId: string;
    generationId: number;
    currentGenerationId: number;
    outputMode: "speech" | "typing";
  }
>;

export type SpeechSignalApplicationResult =
  | Readonly<{
      status: "observed";
      attemptId: string;
      generationId: number;
      quality: "usable";
      observation: SpeechSignalObservation;
      disposition: "diagnostic-only";
    }>
  | Readonly<{
      status: "pending-verification";
      attemptId: string;
      generationId: number;
      quality: "insufficient";
      observation: SpeechSignalObservation;
      disposition: "no-negative-evidence";
    }>
  | Readonly<{
      status: "recoverable-error";
      attemptId: string;
      generationId: number;
      code: SpeechSignalErrorCode;
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

export class SpeechSignalApplicationError extends Error {
  readonly code = "speech-signal-not-eligible" as const;

  constructor(message: string) {
    super(message);
    this.name = "SpeechSignalApplicationError";
  }
}

export async function analyzeSpeechSignalAttempt(
  analyzer: SpeechSignalAnalyzer,
  input: AnalyzeSpeechSignalAttemptInput,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<SpeechSignalApplicationResult> {
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
    throw new SpeechSignalApplicationError(
      "Local speech signal analysis is available only for spoken output.",
    );
  }

  const analyzerInput: SpeechSignalInput = {
    audioBytes: input.audioBytes,
    mimeType: input.mimeType,
    locale: input.locale,
    attemptId: input.attemptId,
    generationId: input.generationId,
  };

  try {
    validateSpeechSignalInput(analyzerInput);
    const observation = await analyzer.analyze(analyzerInput, options);

    if (observation.quality === "insufficient") {
      return {
        status: "pending-verification",
        attemptId: input.attemptId,
        generationId: input.generationId,
        quality: "insufficient",
        observation,
        disposition: "no-negative-evidence",
      };
    }

    return {
      status: "observed",
      attemptId: input.attemptId,
      generationId: input.generationId,
      quality: "usable",
      observation,
      disposition: "diagnostic-only",
    };
  } catch (error) {
    if (!(error instanceof SpeechSignalError)) throw error;
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
