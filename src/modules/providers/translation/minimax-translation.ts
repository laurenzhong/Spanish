import "server-only";

import { z } from "zod";

import { TranslationError, validateTranslationInput, type TranslationInput, type TranslationProvider, type TranslationResult } from "./translation";

const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const responseSchema = z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()) }).passthrough();

type Options = Readonly<{ apiKey: string; endpoint?: string; modelVersion?: string; timeoutMs?: number; fetchImplementation?: typeof fetch }>;

export class MiniMaxTranslationProvider implements TranslationProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(private readonly options: Options) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async translate(input: TranslationInput, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<TranslationResult> {
    validateTranslationInput(input);
    if (!this.options.apiKey.trim()) throw new TranslationError("provider-auth-failed", "Translation is not configured.", false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const startedAt = Date.now();
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": this.options.apiKey },
        body: JSON.stringify({
          model: this.modelVersion,
          max_tokens: 800,
          thinking: { type: "disabled" },
          system: "Translate the supplied text from Spanish to Simplified Chinese. Return only the translation, with no explanation, notes, quotation marks, or alternate versions.",
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(input) }] }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw errorForStatus(response.status);
      const payload = responseSchema.safeParse(await response.json());
      const text = payload.success ? payload.data.content.map((item) => item.text).join("\n").trim() : "";
      if (!text) throw new TranslationError("provider-response-invalid", "Translation response was invalid.", false);
      return { text, provider: "minimax", modelVersion: this.modelVersion, providerRequestId: response.headers.get("x-request-id"), latencyMs: Date.now() - startedAt, estimatedCostMicros: null };
    } catch (error) {
      if (error instanceof TranslationError) throw error;
      if (options.signal?.aborted || controller.signal.aborted) throw new TranslationError("provider-cancelled", "Translation was cancelled.", false);
      throw new TranslationError("provider-unavailable", "Translation is temporarily unavailable.", true);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

export function createMiniMaxTranslationProvider(options: Partial<Options> = {}): MiniMaxTranslationProvider {
  return new MiniMaxTranslationProvider({ ...options, apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "" });
}

function errorForStatus(status: number): TranslationError {
  if (status === 401 || status === 403) return new TranslationError("provider-auth-failed", "Translation provider authentication failed.", false);
  if (status === 429) return new TranslationError("provider-rate-limited", "Translation provider rate limit was reached.", true);
  if (status >= 500) return new TranslationError("provider-unavailable", "Translation provider is temporarily unavailable.", true);
  return new TranslationError("provider-response-invalid", "Translation response was invalid.", false);
}
