import {
  SpeechToTextError,
  type SpeechToTextInput,
  type SpeechToTextProvider,
  type TranscriptResult,
} from "./transcription";

export type FakeSpeechToTextOutcome =
  | TranscriptResult
  | SpeechToTextError
  | (() => TranscriptResult | SpeechToTextError);

export class FakeSpeechToTextProvider implements SpeechToTextProvider {
  readonly inputs: SpeechToTextInput[] = [];

  constructor(
    private readonly outcome: FakeSpeechToTextOutcome = defaultTranscript,
  ) {}

  async transcribe(
    input: SpeechToTextInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<TranscriptResult> {
    this.inputs.push(input);
    if (options.signal?.aborted) {
      throw new SpeechToTextError(
        "provider-cancelled",
        "Speech transcription was cancelled.",
        false,
      );
    }

    const result = typeof this.outcome === "function" ? this.outcome() : this.outcome;
    if (result instanceof SpeechToTextError) throw result;
    return result;
  }
}

const defaultTranscript: TranscriptResult = {
  text: "Hola, ¿qué tal?",
  detectedLanguages: ["es"],
  confidence: null,
  confidenceAvailability: "unavailable",
  provider: "fake",
  modelVersion: "fake-v1",
  providerRequestId: null,
  latencyMs: 0,
  estimatedCostMicros: 0,
  retentionPolicy: "ephemeral",
};
