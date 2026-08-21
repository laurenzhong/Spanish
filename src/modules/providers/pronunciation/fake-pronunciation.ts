import {
  PronunciationAssessmentError,
  type PronunciationAssessmentInput,
  type PronunciationAssessmentResult,
  type PronunciationProvider,
  validatePronunciationInput,
} from "./pronunciation";

export type FakePronunciationOutcome =
  | PronunciationAssessmentResult
  | PronunciationAssessmentError
  | (() => PronunciationAssessmentResult | PronunciationAssessmentError);

export type FakePronunciationProviderOptions = Readonly<{
  outcome?: FakePronunciationOutcome;
  delayMs?: number;
}>;

export class FakePronunciationProvider implements PronunciationProvider {
  readonly inputs: PronunciationAssessmentInput[] = [];

  private readonly outcome: FakePronunciationOutcome;
  private readonly delayMs: number;

  constructor(options: FakePronunciationProviderOptions = {}) {
    this.outcome = options.outcome ?? defaultPronunciationResult;
    this.delayMs = options.delayMs ?? 0;
  }

  async assess(
    input: PronunciationAssessmentInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<PronunciationAssessmentResult> {
    validatePronunciationInput(input);
    this.inputs.push(input);
    await waitForDelay(this.delayMs, options.signal);

    const result =
      typeof this.outcome === "function" ? this.outcome() : this.outcome;
    if (result instanceof PronunciationAssessmentError) throw result;
    return result;
  }
}

const defaultPronunciationResult: PronunciationAssessmentResult = {
  quality: "usable",
  pronunciationScore: 0.84,
  fluencyScore: 0.78,
  prosodyScore: 0.74,
  completenessScore: 0.96,
  provider: "fake",
  modelVersion: "fake-pronunciation-v1",
  providerRequestId: null,
  latencyMs: 0,
  estimatedCostMicros: 0,
  retentionPolicy: "ephemeral",
};

function waitForDelay(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(cancellationError());
  }

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

function cancellationError(): PronunciationAssessmentError {
  return new PronunciationAssessmentError(
    "provider-cancelled",
    "Pronunciation assessment was cancelled.",
    false,
  );
}
