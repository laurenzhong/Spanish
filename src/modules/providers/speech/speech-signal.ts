export const speechSignalErrorCodes = [
  "audio-invalid",
  "audio-too-large",
  "audio-format-unsupported",
  "locale-unsupported",
  "audio-decode-failed",
  "provider-cancelled",
] as const;

export type SpeechSignalErrorCode = (typeof speechSignalErrorCodes)[number];
export type SpeechSignalLocale = "es-ES" | "es-MX";

export type SpeechSignalInput = Readonly<{
  audioBytes: Uint8Array;
  mimeType: string;
  locale: SpeechSignalLocale;
  attemptId: string;
  generationId: number;
}>;

export type DecodedSpeechSignal = Readonly<{
  sampleRate: number;
  monoSamples: Float32Array;
}>;

export type SpeechSignalObservation = Readonly<{
  quality: "usable" | "insufficient";
  durationMs: number;
  voicedRatio: number | null;
  pauseCount: number | null;
  pauseRatio: number | null;
  analyzer: "local-signal" | "fake";
  algorithmVersion: string;
  latencyMs: number;
  retentionPolicy: "ephemeral";
}>;

export type SpeechSignalDecoder = (
  input: SpeechSignalInput,
  options?: Readonly<{ signal?: AbortSignal }>,
) => Promise<DecodedSpeechSignal>;

export interface SpeechSignalAnalyzer {
  analyze(
    input: SpeechSignalInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<SpeechSignalObservation>;
}

export class SpeechSignalError extends Error {
  readonly code: SpeechSignalErrorCode;
  readonly retryable: boolean;

  constructor(
    code: SpeechSignalErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "SpeechSignalError";
    this.code = code;
    this.retryable = retryable;
  }
}

export const maxSpeechSignalAudioBytes = 25 * 1024 * 1024;

export const supportedSpeechSignalMimeTypes = [
  "audio/m4a",
  "audio/mp4",
  "audio/mp3",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
] as const;

const supportedMimeTypes = new Set<string>(supportedSpeechSignalMimeTypes);
const supportedLocales = new Set<string>(["es-ES", "es-MX"]);

export function normalizeSpeechSignalMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function validateSpeechSignalInput(input: SpeechSignalInput): void {
  if (input.audioBytes.byteLength === 0) {
    throw new SpeechSignalError("audio-invalid", "Audio input is empty.", false);
  }

  if (input.audioBytes.byteLength > maxSpeechSignalAudioBytes) {
    throw new SpeechSignalError(
      "audio-too-large",
      "Audio input exceeds the 25 MB limit.",
      false,
    );
  }

  if (!supportedMimeTypes.has(normalizeSpeechSignalMimeType(input.mimeType))) {
    throw new SpeechSignalError(
      "audio-format-unsupported",
      "Audio MIME type is not supported by the local signal analyzer.",
      false,
    );
  }

  if (!supportedLocales.has(input.locale)) {
    throw new SpeechSignalError(
      "locale-unsupported",
      "Speech signal locale is not supported.",
      false,
    );
  }

  if (!Number.isInteger(input.generationId) || input.generationId < 0) {
    throw new SpeechSignalError(
      "audio-invalid",
      "Speech signal generation is invalid.",
      false,
    );
  }
}

export function isSpeechSignalError(
  error: unknown,
): error is SpeechSignalError {
  return error instanceof SpeechSignalError;
}
