import {
  SpeechSignalError,
  type SpeechSignalAnalyzer,
  type SpeechSignalInput,
  type SpeechSignalObservation,
  validateSpeechSignalInput,
} from "./speech-signal";

export type FakeSpeechSignalOutcome =
  | SpeechSignalObservation
  | SpeechSignalError
  | (() => SpeechSignalObservation | SpeechSignalError);

export type FakeSpeechSignalAnalyzerOptions = Readonly<{
  outcome?: FakeSpeechSignalOutcome;
  delayMs?: number;
}>;

export class FakeSpeechSignalAnalyzer implements SpeechSignalAnalyzer {
  readonly inputs: SpeechSignalInput[] = [];

  private readonly outcome: FakeSpeechSignalOutcome;
  private readonly delayMs: number;

  constructor(options: FakeSpeechSignalAnalyzerOptions = {}) {
    this.outcome = options.outcome ?? defaultObservation;
    this.delayMs = options.delayMs ?? 0;
  }

  async analyze(
    input: SpeechSignalInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<SpeechSignalObservation> {
    validateSpeechSignalInput(input);
    this.inputs.push(input);
    await waitForDelay(this.delayMs, options.signal);

    const outcome = typeof this.outcome === "function" ? this.outcome() : this.outcome;
    if (outcome instanceof SpeechSignalError) throw outcome;
    return outcome;
  }
}

const defaultObservation: SpeechSignalObservation = {
  quality: "usable",
  durationMs: 920,
  voicedRatio: 0.81,
  pauseCount: 1,
  pauseRatio: 0.12,
  analyzer: "fake",
  algorithmVersion: "fake-speech-signal-v1",
  latencyMs: 0,
  retentionPolicy: "ephemeral",
};

function waitForDelay(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancellationError());
  if (delayMs <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(cancellationError());
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function cancellationError(): SpeechSignalError {
  return new SpeechSignalError(
    "provider-cancelled",
    "Local signal analysis was cancelled.",
    false,
  );
}
