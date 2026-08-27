import "server-only";

import { z } from "zod";

import {
  generatedStoryPayloadSchema,
  StoryGenerationError,
  type StoryGenerationInput,
  type StoryGenerationProvider,
  type StoryGenerationResult,
  validateStoryGenerationInput,
} from "./story-generation";

const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const defaultTimeoutMs = 30_000;
const maxCharacters = 8_000;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Clock = () => number;

export type MiniMaxStoryGenerationProviderOptions = Readonly<{
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

const anthropicResponseSchema = z.object({
  // MiniMax M3 may include non-text reasoning blocks even with thinking disabled.
  // They are intentionally ignored; only text blocks can become article content.
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).min(1),
}).passthrough();

export class MiniMaxStoryGenerationProvider implements StoryGenerationProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: MiniMaxStoryGenerationProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  async generate(
    input: StoryGenerationInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<StoryGenerationResult> {
    validateStoryGenerationInput(input);
    if (!this.options.apiKey.trim()) {
      throw new StoryGenerationError("provider-auth-failed", "Story generation is not configured.", false);
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
          max_tokens: 2_600,
          thinking: { type: "disabled" },
          stream: false,
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
      if (!parsedResponse.success) throw invalidResponse();
      const text = parsedResponse.data.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("\n")
        .trim();
      if (!text) throw invalidResponse();
      const parsedStory = parseStoryPayload(text);
      return {
        ...parsedStory,
        provider: "minimax",
        modelVersion: this.modelVersion,
        providerRequestId,
        latencyMs: Math.max(0, this.clock() - startedAt),
        estimatedCostMicros: null,
      };
    } catch (error) {
      if (error instanceof StoryGenerationError) throw error;
      if (requestSignal.timedOut()) throw new StoryGenerationError("provider-timeout", "Story generation timed out.", true);
      if (requestSignal.signal.aborted) throw new StoryGenerationError("provider-cancelled", "Story generation was cancelled.", false);
      throw new StoryGenerationError("provider-unavailable", "Story generation is temporarily unavailable.", true);
    } finally {
      requestSignal.dispose();
    }
  }
}

export function createMiniMaxStoryGenerationProvider(
  options: Omit<MiniMaxStoryGenerationProviderOptions, "apiKey"> & Partial<Pick<MiniMaxStoryGenerationProviderOptions, "apiKey">> = {},
): MiniMaxStoryGenerationProvider {
  return new MiniMaxStoryGenerationProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint,
  });
}

const systemPrompt = [
  "You write safe, engaging Spanish reading texts for an adult language learner.",
  "Return JSON only with title, summary, segments, cefr, topics, and register.",
  "Write the complete text in Spanish and respect the requested CEFR, format, and approximate length.",
  "Keep segments as plain text paragraphs with no HTML, markdown, headings labels, or commentary.",
  "Do not include unverified current events, real-world claims, private data, contact details, or instructions to meet people offline.",
  "A story may be fictional; do not present invented places, homes, events, or actions as verified reality.",
].join(" ");

function buildPrompt(input: StoryGenerationInput): string {
  return JSON.stringify({
    task: "generate_private_spanish_reading_text",
    prompt: input.prompt,
    cefr: input.cefr,
    length: input.length,
    format: input.format,
    keywords: input.keywords,
    constraints: {
      language: "es",
      privateDraft: true,
      oralEvidence: false,
      maxCharacters,
    },
  });
}

function parseStoryPayload(text: string): z.infer<typeof generatedStoryPayloadSchema> {
  const normalized = text.trim();
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw invalidResponse();
  }
  const parsed = generatedStoryPayloadSchema.safeParse(value);
  if (!parsed.success || parsed.data.segments.join("\n\n").length > maxCharacters) throw invalidResponse();
  return parsed.data;
}

function invalidResponse(): StoryGenerationError {
  return new StoryGenerationError("provider-response-invalid", "Story provider response did not match the expected format.", false);
}

function errorForResponseStatus(status: number): StoryGenerationError {
  if (status === 401 || status === 403) return new StoryGenerationError("provider-auth-failed", "Story generation provider authentication failed.", false);
  if (status === 429) return new StoryGenerationError("provider-rate-limited", "Story generation provider rate limit was reached.", true);
  if (status >= 500) return new StoryGenerationError("provider-unavailable", "Story generation provider is temporarily unavailable.", true);
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
