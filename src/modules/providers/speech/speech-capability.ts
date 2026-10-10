export const speechCapabilityErrorCodes = [
  "microphone-not-supported",
  "microphone-permission-denied",
  "microphone-format-unsupported",
  "recording-already-active",
  "recording-not-active",
  "recording-failed",
  "tts-not-supported",
  "tts-failed",
  // The engine accepted the utterance but never started it: the selected voice
  // can be listed yet unusable, which is otherwise a silent no-op for the user.
  "tts-no-audio",
  // The engine started the utterance and then never reported its end.
  "tts-stalled",
  "tts-cancelled",
] as const;

export type SpeechCapabilityErrorCode =
  (typeof speechCapabilityErrorCodes)[number];

export class SpeechCapabilityError extends Error {
  readonly code: SpeechCapabilityErrorCode;

  constructor(code: SpeechCapabilityErrorCode, message: string) {
    super(message);
    this.name = "SpeechCapabilityError";
    this.code = code;
  }
}

export function speechCapabilityErrorCode(
  error: unknown,
  fallback: SpeechCapabilityErrorCode,
): SpeechCapabilityErrorCode {
  if (error instanceof SpeechCapabilityError) return error.code;
  return fallback;
}

export type RecordedAudioMetadata = Readonly<{
  mimeType: string;
  sizeBytes: number;
}>;
