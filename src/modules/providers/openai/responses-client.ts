import "server-only";

import { z } from "zod";

import { ScenarioProviderError } from "../routing/scenario-provider-router";

const defaultEndpoint = "https://api.openai.com/v1/responses";
const defaultModelVersion = "gpt-5.6-sol";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type OpenAIResponsesClientOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
  clock?: () => number;
}>;

const responseSchema = z.object({
  output_text: z.string().optional(),
  output: z.array(z.object({
    content: z.array(z.object({
      type: z.literal("output_text"),
      text: z.string(),
    }).passthrough()).optional(),
  }).passthrough()).optional(),
}).passthrough();

export class OpenAIResponsesClient {
  readonly modelVersion: string;

  constructor(private readonly options: OpenAIResponsesClientOptions) {
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
  }

  async generateText(
    input: Readonly<{ instructions: string; input: string; maxOutputTokens: number }>,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<Readonly<{ text: string; providerRequestId: string | null; latencyMs: number }>> {
    if (!this.options.apiKey.trim()) {
      throw new ScenarioProviderError("PROVIDER_NOT_CONFIGURED", "OpenAI scenario provider is not configured.", false);
    }
    const requestSignal = createRequestSignal(options.signal, this.options.timeoutMs ?? 30_000);
    const clock = this.options.clock ?? Date.now;
    const startedAt = clock();
    try {
      const response = await (this.options.fetchImplementation ?? fetch)(this.options.endpoint ?? defaultEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelVersion,
          instructions: input.instructions,
          input: input.input,
          max_output_tokens: input.maxOutputTokens,
          stream: false,
        }),
        signal: requestSignal.signal,
      });
      const providerRequestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
      if (!response.ok) throw errorForStatus(response.status);
      const payload = responseSchema.safeParse(await response.json().catch(() => null));
      if (!payload.success) throw invalidResponse();
      const text = payload.data.output_text?.trim() || payload.data.output
        ?.flatMap((item) => item.content?.map((block) => block.text) ?? [])
        .join("\n")
        .trim();
      if (!text) throw invalidResponse();
      return {
        text,
        providerRequestId,
        latencyMs: Math.max(0, clock() - startedAt),
      };
    } catch (error) {
      if (error instanceof ScenarioProviderError) throw error;
      if (requestSignal.timedOut()) {
        throw new ScenarioProviderError("provider-timeout", "OpenAI scenario provider timed out.", true);
      }
      if (requestSignal.signal.aborted) {
        throw new ScenarioProviderError("provider-cancelled", "OpenAI scenario provider was cancelled.", false);
      }
      throw new ScenarioProviderError("provider-unavailable", "OpenAI scenario provider is temporarily unavailable.", true);
    } finally {
      requestSignal.dispose();
    }
  }
}

function invalidResponse() {
  return new ScenarioProviderError("provider-response-invalid", "OpenAI scenario provider returned an invalid response.", false);
}

function errorForStatus(status: number) {
  if (status === 401 || status === 403) return new ScenarioProviderError("provider-auth-failed", "OpenAI scenario provider authentication failed.", false);
  if (status === 429) return new ScenarioProviderError("provider-rate-limited", "OpenAI scenario provider rate limit was reached.", true);
  if (status >= 500) return new ScenarioProviderError("provider-unavailable", "OpenAI scenario provider is temporarily unavailable.", true);
  return invalidResponse();
}

function createRequestSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => { didTimeout = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    },
  };
}
