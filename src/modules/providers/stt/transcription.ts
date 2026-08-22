export const transcriptionErrorCodes = [
  "audio-invalid",
  "audio-too-large",
  "audio-format-unsupported",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
] as const;

export type TranscriptionErrorCode = (typeof transcriptionErrorCodes)[number];

export type SpeechToTextInput = Readonly<{
  audioBytes: Uint8Array;
  mimeType: string;
  fileName: string;
  languageTag?: string;
}>;

export type TranscriptResult = Readonly<{
  text: string;
  detectedLanguages: readonly string[];
  confidence: number | null;
  confidenceAvailability: "unavailable" | "provider";
  provider: "openai" | "local-whisper" | "fake";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
  retentionPolicy: "ephemeral";
}>;

export interface SpeechToTextProvider {
  transcribe(
    input: SpeechToTextInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<TranscriptResult>;
}

export class SpeechToTextError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly retryable: boolean;

  constructor(
    code: TranscriptionErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "SpeechToTextError";
    this.code = code;
    this.retryable = retryable;
  }
}

export const maxTranscriptionAudioBytes = 25 * 1024 * 1024;

export const supportedTranscriptionMimeTypes = [
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

const supportedMimeTypes = new Set<string>(supportedTranscriptionMimeTypes);

export function normalizeTranscriptionMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function validateSpeechToTextInput(input: SpeechToTextInput): void {
  if (input.audioBytes.byteLength === 0) {
    throw new SpeechToTextError(
      "audio-invalid",
      "Audio input is empty.",
      false,
    );
  }

  if (input.audioBytes.byteLength > maxTranscriptionAudioBytes) {
    throw new SpeechToTextError(
      "audio-too-large",
      "Audio input exceeds the 25 MB limit.",
      false,
    );
  }

  if (!supportedMimeTypes.has(normalizeTranscriptionMimeType(input.mimeType))) {
    throw new SpeechToTextError(
      "audio-format-unsupported",
      "Audio MIME type is not supported.",
      false,
    );
  }
}

export function isSpeechToTextError(
  error: unknown,
): error is SpeechToTextError {
  return error instanceof SpeechToTextError;
}
