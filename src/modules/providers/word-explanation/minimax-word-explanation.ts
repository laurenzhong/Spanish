import "server-only";

import { z } from "zod";

import {
  validateWordExplanationInput,
  WordExplanationError,
  type WordExplanation,
  type WordExplanationInput,
  type WordExplanationProvider,
  type WordExplanationStreamEvent,
} from "./word-explanation";

const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const defaultTimeoutMs = 30_000;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type Clock = () => number;

export type MiniMaxWordExplanationProviderOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
  clock?: Clock;
}>;

type RequestSignal = Readonly<{
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
}>;

const explanationSchema = z.object({
  partOfSpeech: z.string().trim().min(1).max(120),
  meaning: z.string().trim().min(1).max(500),
  contextualMeaning: z.string().trim().min(1).max(700),
  example: z.string().trim().min(1).max(500),
}).strict();

const anthropicResponseSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()),
}).passthrough();

export class MiniMaxWordExplanationProvider implements WordExplanationProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: MiniMaxWordExplanationProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  async explain(
    input: WordExplanationInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<WordExplanation> {
    validateWordExplanationInput(input);
    if (!this.options.apiKey.trim()) {
      throw new WordExplanationError(
        "provider-auth-failed",
        "Word explanation is not configured.",
        false,
      );
    }

    const requestSignal = createRequestSignal(options.signal, this.timeoutMs);
    const startedAt = this.clock();

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          model: this.modelVersion,
          max_tokens: 500,
          thinking: { type: "disabled" },
          system: systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(input) }] }],
        }),
        signal: requestSignal.signal,
      });
      const providerRequestId = response.headers.get("x-request-id");

      if (!response.ok) throw errorForResponseStatus(response.status);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw invalidResponse();
      }
      const parsedResponse = anthropicResponseSchema.safeParse(payload);
      if (!parsedResponse.success || parsedResponse.data.content.length === 0) {
        throw invalidResponse();
      }
      const text = parsedResponse.data.content.map((block) => block.text).join("\n");
      const explanation = parseExplanationPayload(text);

      return {
        ...explanation,
        provider: "minimax",
        modelVersion: this.modelVersion,
        providerRequestId,
        latencyMs: Math.max(0, this.clock() - startedAt),
        estimatedCostMicros: null,
      };
    } catch (error) {
      if (error instanceof WordExplanationError) throw error;
      if (requestSignal.timedOut()) {
        throw new WordExplanationError("provider-timeout", "Word explanation timed out.", true);
      }
      if (requestSignal.signal.aborted) {
        throw new WordExplanationError("provider-cancelled", "Word explanation was cancelled.", false);
      }
      throw new WordExplanationError("provider-unavailable", "Word explanation is temporarily unavailable.", true);
    } finally {
      requestSignal.dispose();
    }
  }

  async *explainStream(
    input: WordExplanationInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): AsyncIterable<WordExplanationStreamEvent> {
    validateWordExplanationInput(input);
    if (!this.options.apiKey.trim()) throw new WordExplanationError("provider-auth-failed", "Word explanation is not configured.", false);
    const requestSignal = createRequestSignal(options.signal, this.timeoutMs);
    const startedAt = this.clock();
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": this.options.apiKey },
        body: JSON.stringify({
          model: this.modelVersion,
          max_tokens: 500,
          thinking: { type: "disabled" },
          stream: true,
          system: systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(input) }] }],
        }),
        signal: requestSignal.signal,
      });
      if (!response.ok) throw errorForResponseStatus(response.status);
      if (!response.body) throw invalidResponse();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      const emitLine = function* (line: string): Generator<WordExplanationStreamEvent> {
        const data = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
        if (!data || data === "[DONE]") return;
        let event: unknown;
        try { event = JSON.parse(data); } catch { return; }
        const delta = event && typeof event === "object" && "delta" in event ? (event as { delta?: { text?: unknown } }).delta?.text : undefined;
        if (typeof delta === "string" && delta) { text += delta; yield { type: "delta", text: delta }; }
      };
      while (true) {
        const result = await reader.read();
        buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";
        for (const line of lines) yield* emitLine(line);
        if (result.done) break;
      }
      if (buffer.trim()) yield* emitLine(buffer);
      const explanation = parseExplanationPayload(text);
      yield { type: "done", explanation: { ...explanation, provider: "minimax", modelVersion: this.modelVersion, providerRequestId: response.headers.get("x-request-id"), latencyMs: Math.max(0, this.clock() - startedAt), estimatedCostMicros: null } };
    } catch (error) {
      if (error instanceof WordExplanationError) throw error;
      if (requestSignal.timedOut()) throw new WordExplanationError("provider-timeout", "Word explanation timed out.", true);
      if (requestSignal.signal.aborted) throw new WordExplanationError("provider-cancelled", "Word explanation was cancelled.", false);
      throw new WordExplanationError("provider-unavailable", "Word explanation is temporarily unavailable.", true);
    } finally { requestSignal.dispose(); }
  }
}

export function createMiniMaxWordExplanationProvider(
  options: Omit<MiniMaxWordExplanationProviderOptions, "apiKey"> &
    Partial<Pick<MiniMaxWordExplanationProviderOptions, "apiKey">> = {},
): MiniMaxWordExplanationProvider {
  return new MiniMaxWordExplanationProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint,
  });
}

const systemPrompt = [
  "You are a Spanish-learning dictionary assistant.",
  "Explain only the supplied Spanish selection in the supplied sentence context.",
  "When selectionType is word, explain the word. When selectionType is sentence, translate and explain the whole selected sentence; do not focus on one word.",
  "Return JSON only with partOfSpeech, meaning, contextualMeaning, and example.",
  "Write the explanations in Simplified Chinese and keep the example in Spanish.",
  "Do not invent facts about the learner, the article, or the world.",
].join(" ");

function buildPrompt(input: WordExplanationInput): string {
  return JSON.stringify({
    task: input.selectionType === "sentence" ? "explain_sentence" : "explain_word_in_context",
    selectionType: input.selectionType ?? "word",
    word: input.word,
    context: input.context,
    locale: input.locale,
  });
}

function parseExplanationPayload(text: string): z.infer<typeof explanationSchema> {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw invalidResponse();
  }
  const parsed = explanationSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}

function invalidResponse(): WordExplanationError {
  return new WordExplanationError(
    "provider-response-invalid",
    "Word explanation response did not match the expected format.",
    false,
  );
}

function errorForResponseStatus(status: number): WordExplanationError {
  if (status === 401 || status === 403) return new WordExplanationError("provider-auth-failed", "Word explanation provider authentication failed.", false);
  if (status === 429) return new WordExplanationError("provider-rate-limited", "Word explanation provider rate limit was reached.", true);
  if (status >= 500) return new WordExplanationError("provider-unavailable", "Word explanation provider is temporarily unavailable.", true);
  return invalidResponse();
}

function createRequestSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): RequestSignal {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => { didTimeout = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    },
  };
}
