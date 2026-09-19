export const translationErrorCodes = [
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
] as const;

export type TranslationInput = Readonly<{
  text: string;
  sourceLocale: string;
  targetLocale: string;
}>;

export type TranslationResult = Readonly<{
  text: string;
  provider: "minimax" | "openai" | "fake";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
}>;

export interface TranslationProvider {
  translate(input: TranslationInput, options?: Readonly<{ signal?: AbortSignal }>): Promise<TranslationResult>;
}

export class TranslationError extends Error {
  readonly code: (typeof translationErrorCodes)[number];
  readonly retryable: boolean;

  constructor(code: (typeof translationErrorCodes)[number], message: string, retryable: boolean) {
    super(message);
    this.name = "TranslationError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function validateTranslationInput(input: TranslationInput): void {
  if (!input.text.trim() || input.text.length > 4_000 || !input.sourceLocale.trim() || input.sourceLocale.length > 32 || !input.targetLocale.trim() || input.targetLocale.length > 32) {
    throw new TranslationError("provider-response-invalid", "Translation input is invalid.", false);
  }
}
