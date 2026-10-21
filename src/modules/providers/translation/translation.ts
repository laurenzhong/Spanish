import { z } from "zod";

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
  context?: readonly Readonly<{ role: "user" | "assistant"; text: string }>[];
}>;

const nonBlankText = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0);
const inputSchema = z.object({
  text: nonBlankText(4_000),
  sourceLocale: z.enum(["es-ES", "zh-CN"]),
  targetLocale: z.enum(["es-ES", "zh-CN"]),
  // Six messages of at most 2000 characters also bounds the full context to 12000.
  context: z.array(z.object({ role: z.enum(["user", "assistant"]), text: nonBlankText(2_000) }).strict()).max(6).optional(),
}).refine((input) => input.sourceLocale !== input.targetLocale);

export type TranslationResult = Readonly<{
  text: string;
  provider: "minimax" | "fake";
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
  if (!inputSchema.safeParse(input).success) {
    throw new TranslationError("provider-response-invalid", "Translation input is invalid.", false);
  }
}
