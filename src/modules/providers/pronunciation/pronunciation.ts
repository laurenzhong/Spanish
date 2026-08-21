export const pronunciationErrorCodes = [
  "audio-invalid",
  "audio-too-large",
  "audio-format-unsupported",
  "locale-unsupported",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
] as const;

export type PronunciationErrorCode = (typeof pronunciationErrorCodes)[number];

export const pronunciationLocales = ["es-ES", "es-MX"] as const;
export type PronunciationLocale = (typeof pronunciationLocales)[number];

export type PronunciationAssessmentInput = Readonly<{
  audioBytes: Uint8Array;
  mimeType: string;
  fileName: string;
  locale: PronunciationLocale;
  referenceText?: string;
  attemptId: string;
  generationId: number;
}>;

export type PronunciationAssessmentQuality = "usable" | "insufficient";

export type PronunciationAssessmentResult = Readonly<{
  quality: PronunciationAssessmentQuality;
  pronunciationScore: number | null;
  fluencyScore: number | null;
  prosodyScore: number | null;
  completenessScore: number | null;
  provider: "speechace" | "azure" | "fake";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
  retentionPolicy: "ephemeral";
}>;

export interface PronunciationProvider {
  assess(
    input: PronunciationAssessmentInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PronunciationAssessmentResult>;
}

export class PronunciationAssessmentError extends Error {
  readonly code: PronunciationErrorCode;
  readonly retryable: boolean;

  constructor(
    code: PronunciationErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "PronunciationAssessmentError";
    this.code = code;
    this.retryable = retryable;
  }
}

export const maxPronunciationAudioBytes = 25 * 1024 * 1024;

export const supportedPronunciationMimeTypes = [
  "audio/m4a",
  "audio/mp4",
  "audio/mp3",
  "audio/mpeg",
  "audio/mpga",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav",
] as const;

const supportedMimeTypes = new Set<string>(supportedPronunciationMimeTypes);
const supportedLocales = new Set<string>(pronunciationLocales);

export function normalizePronunciationMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function validatePronunciationInput(
  input: PronunciationAssessmentInput,
): void {
  if (input.audioBytes.byteLength === 0) {
    throw new PronunciationAssessmentError(
      "audio-invalid",
      "Audio input is empty.",
      false,
    );
  }

  if (input.audioBytes.byteLength > maxPronunciationAudioBytes) {
    throw new PronunciationAssessmentError(
      "audio-too-large",
      "Audio input exceeds the 25 MB limit.",
      false,
    );
  }

  if (!supportedMimeTypes.has(normalizePronunciationMimeType(input.mimeType))) {
    throw new PronunciationAssessmentError(
      "audio-format-unsupported",
      "Audio MIME type is not supported.",
      false,
    );
  }

  if (!supportedLocales.has(input.locale)) {
    throw new PronunciationAssessmentError(
      "locale-unsupported",
      "Pronunciation locale is not supported.",
      false,
    );
  }

  if (!Number.isInteger(input.generationId) || input.generationId < 0) {
    throw new PronunciationAssessmentError(
      "provider-response-invalid",
      "Pronunciation generation is invalid.",
      false,
    );
  }
}

export function isPronunciationAssessmentError(
  error: unknown,
): error is PronunciationAssessmentError {
  return error instanceof PronunciationAssessmentError;
}
