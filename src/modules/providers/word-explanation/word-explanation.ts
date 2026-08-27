export const wordExplanationErrorCodes = [
  "input-invalid",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
] as const;

export type WordExplanationErrorCode = (typeof wordExplanationErrorCodes)[number];

export type WordExplanationInput = Readonly<{
  word: string;
  context: string;
  locale: string;
  selectionType?: "word" | "sentence";
}>;

export type WordExplanation = Readonly<{
  partOfSpeech: string;
  meaning: string;
  contextualMeaning: string;
  example: string;
  provider: "minimax" | "fake";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
}>;

export interface WordExplanationProvider {
  explain(
    input: WordExplanationInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<WordExplanation>;
}

export class WordExplanationError extends Error {
  readonly code: WordExplanationErrorCode;
  readonly retryable: boolean;

  constructor(
    code: WordExplanationErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "WordExplanationError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function validateWordExplanationInput(input: WordExplanationInput): void {
  const selectionType = input.selectionType ?? "word";
  if (
    !input.word.trim() ||
    (selectionType === "word" && input.word.length > 120) ||
    (selectionType === "sentence" && input.word.length > 2_000) ||
    !input.context.trim() ||
    input.context.length > 2_000 ||
    !input.locale.trim() ||
    input.locale.length > 32
  ) {
    throw new WordExplanationError(
      "input-invalid",
      "Word explanation input is invalid.",
      false,
    );
  }
}
