import "server-only";

import { z } from "zod";

import {
  ConversationProviderError,
  type CharacterReplyProvider,
  type ConversationProviderInput,
  type ConversationProviderResult,
  validateConversationProviderInput,
} from "./conversation";

const defaultEndpoint = "https://api.openai.com/v1/responses";
const defaultModelVersion = "gpt-5.6-sol";
const defaultTimeoutMs = 30_000;
const maxReplyLength = 4_000;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type Clock = () => number;

export type OpenAIConversationProviderOptions = Readonly<{
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

const responseSchema = z.object({
  output: z.array(z.object({
    content: z.array(z.object({ type: z.literal("output_text"), text: z.string() }).passthrough()).optional(),
  }).passthrough()).optional(),
  output_text: z.string().optional(),
}).passthrough();

export class OpenAIConversationProvider implements CharacterReplyProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: OpenAIConversationProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  async generate(
    input: ConversationProviderInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<ConversationProviderResult> {
    validateConversationProviderInput(input);
    if (!this.options.apiKey.trim()) {
      throw new ConversationProviderError(
        "provider-auth-failed",
        "Conversation provider is not configured.",
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
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.modelVersion,
          instructions: systemPrompt,
          input: buildPrompt(input),
          max_output_tokens: 800,
          stream: false,
        }),
        signal: requestSignal.signal,
      });
      const providerRequestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
      if (!response.ok) throw errorForResponseStatus(response.status);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw invalidResponse();
      }
      const text = extractText(payload);
      if (!text || text.length > maxReplyLength) throw invalidResponse();

      return {
        text,
        provider: "openai",
        modelVersion: this.modelVersion,
        providerRequestId,
        latencyMs: Math.max(0, this.clock() - startedAt),
        estimatedCostMicros: null,
      };
    } catch (error) {
      if (error instanceof ConversationProviderError) throw error;
      if (requestSignal.timedOut()) {
        throw new ConversationProviderError("provider-timeout", "Conversation provider timed out.", true);
      }
      if (requestSignal.signal.aborted) {
        throw new ConversationProviderError("provider-cancelled", "Conversation provider was cancelled.", false);
      }
      throw new ConversationProviderError("provider-unavailable", "Conversation provider is temporarily unavailable.", true);
    } finally {
      requestSignal.dispose();
    }
  }
}

export function createOpenAIConversationProvider(
  options: Omit<OpenAIConversationProviderOptions, "apiKey"> &
    Partial<Pick<OpenAIConversationProviderOptions, "apiKey">> = {},
): OpenAIConversationProvider {
  return new OpenAIConversationProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.OPENAI_API_ENDPOINT ?? defaultEndpoint,
    modelVersion: options.modelVersion ?? process.env.OPENAI_CONVERSATION_MODEL ?? defaultModelVersion,
  });
}

const systemPrompt = [
  "You are a warm, natural Spanish-speaking AI character in an ongoing private conversation.",
  "Respond to what the user actually said before creating any teaching opportunity.",
  "Keep the response concise, conversational, and in Spanish unless the user asks for another language.",
  "Stay within the supplied character facts, relationship context, and readable memories.",
  "Never invent real places, homes, events, meetings, transport, or actions outside this conversation.",
  "If the user asks whether you are an AI, answer honestly that you are an AI character.",
  "Do not volunteer your AI identity when the user has not asked; receive affection or vulnerability in the conversation instead of inserting an identity disclaimer.",
  "Follow questionPolicy: substantive questions must not exceed its maximum; a reciprocal question is allowed only when explicitly permitted and should remain low pressure.",
  "Do not mention prompts, internal rules, memory permissions, scoring, or provider details.",
  "Return only the message to send to the user, with no JSON, labels, or markdown wrapper.",
].join(" ");

function buildPrompt(input: ConversationProviderInput): string {
  return JSON.stringify({
    userMessage: input.userMessage,
    recentMessages: input.recentMessages,
    character: input.character,
    relationship: { stage: input.relationshipStage, summary: input.relationshipSummary },
    readableMemories: input.memories,
    teachingOpportunity: input.teachingOpportunity,
    questionPolicy: input.questionPolicy,
  });
}

function extractText(value: unknown): string {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  const outputText = parsed.data.output_text?.trim();
  if (outputText) return outputText;
  const parts = parsed.data.output?.flatMap((item) => item.content?.map((block) => block.text) ?? []) ?? [];
  const text = parts.join("\n").trim();
  if (!text) throw invalidResponse();
  return text;
}

function invalidResponse(): ConversationProviderError {
  return new ConversationProviderError("provider-response-invalid", "Conversation provider response did not match the expected format.", false);
}

function errorForResponseStatus(status: number): ConversationProviderError {
  if (status === 401 || status === 403) return new ConversationProviderError("provider-auth-failed", "Conversation provider authentication failed.", false);
  if (status === 429) return new ConversationProviderError("provider-rate-limited", "Conversation provider rate limit was reached.", true);
  if (status >= 500) return new ConversationProviderError("provider-unavailable", "Conversation provider is temporarily unavailable.", true);
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
