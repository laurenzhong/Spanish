import "server-only";

import { z } from "zod";

import {
  ConversationProviderError,
  buildConversationSystemPrompt,
  type CharacterReplyProvider,
  type ConversationProviderInput,
  type ConversationProviderResult,
  validateConversationProviderInput,
} from "./conversation";

const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const defaultTimeoutMs = 30_000;
const maxReplyLength = 4_000;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type Clock = () => number;

export type MiniMaxConversationProviderOptions = Readonly<{
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
  content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()).min(1),
}).passthrough();

export class MiniMaxConversationProvider implements CharacterReplyProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: MiniMaxConversationProviderOptions) {
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
          "anthropic-version": "2023-06-01",
          "x-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          model: this.modelVersion,
          max_tokens: 800,
          thinking: { type: "disabled" },
          stream: false,
          system: buildConversationSystemPrompt(input) + " " + systemPrompt,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: buildPrompt(input) }],
            },
          ],
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
      const parsedResponse = parseAnthropicResponse(payload);
      const text = parsedResponse.content.map((block) => block.text).join("\n").trim();
      if (!text || text.length > maxReplyLength) throw invalidResponse();

      return {
        text,
        provider: "minimax",
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

export function createMiniMaxConversationProvider(
  options: Omit<MiniMaxConversationProviderOptions, "apiKey"> &
    Partial<Pick<MiniMaxConversationProviderOptions, "apiKey">> = {},
): MiniMaxConversationProvider {
  return new MiniMaxConversationProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint,
  });
}

const systemPrompt = [
  "Respond to what the user actually said before creating any teaching opportunity.",
  "When the user only sends a greeting such as 'Hola, buenas noches', answer the greeting first. Do not assume an unprovided emotional or situational state and do not add generic wishes such as 'Espero que estés teniendo una noche tranquila' or 'Ojalá...'; continue with a light question or close naturally.",
  "Keep the response concise, conversational, and in Spanish unless the user asks for another language.",
  "Write like a private chat, not an essay: prefer short sentences and ordinary punctuation; avoid colon-led explanations and semicolon-heavy phrasing unless the user clearly uses that style.",
  "Stay within the supplied character facts, relationship context, and readable memories.",
  "Do not present unverified real-world logistics, addresses, current conditions, meetings, or resources as factual. The selected character may have fictional backstory experiences only when they fit the supplied canon; keep them consistent and do not invent contradictory details.",
  "If the user asks whether you are an AI, answer honestly that you are an AI character.",
  "Do not volunteer your AI identity when the user has not asked; receive affection or vulnerability in the conversation instead of inserting an identity disclaimer.",
  "For questions about whether the selected character has physically visited a real place, use only established character/backstory detail if supplied. Do not invent a new biography detail that conflicts with prior conversation.",
  "Follow questionPolicy: substantive questions must not exceed its maximum; a reciprocal question is allowed only when explicitly permitted and should remain low pressure.",
  "Use openTopics and recentMessages for continuity. Do not repeat an already answered question or reuse the same answer mechanically; if the user returns to that topic, acknowledge it naturally and add a genuinely new detail when possible. Do not mention internal topic state.",
  "Use sentAt, currentLocalDate, and sameLocalDay to keep same-day continuity. A topic asked earlier today is not a fresh day; do not reset its state or repeat the same answer.",
  "Treat characterClaims as the selected character's recent self-reports. Daily observations can naturally recur on a later day; only avoid silently contradicting a same-day self-report. If something changes within the same day, say so naturally and briefly.",
  "Use openCommitments as gentle continuity cues. Status=open means pending; returned means the user reported coming back; completed means they explicitly finished; cancelled means they explicitly did not do it; deferred means they moved it to another time; unconfirmed means its due window passed without a clear outcome. Never treat unconfirmed as completed. A returned/completed commitment is already over: never use pre-activity wishes such as 'que lo pases bien', 'que disfrutes', 'que te vaya bien' or 'espero que la actividad te siente bien'. Instead acknowledge the result only when the user supplied it, or ask one low-pressure confirmation when the plan is unconfirmed and the current message naturally returns to it. A status=open commitment may receive a brief good-luck or process-oriented remark. Do not repeatedly ask for an update, and accept that a plan may change or remain unfinished.",
  "For inputKind=proactive, write one natural unsolicited message from the selected character in Spanish. Default to a small everyday check-in or report. Do not ask a question, mention the app, or pressure the user to reply; the supplied source and intensity ceiling are authoritative. When dailyState is waking, prefer concrete morning details such as waking up, coffee, breakfast or starting the day. When the relationship is familiar or closer, a single gentle line of affection is allowed; do not add an explanation or a question.",
  "Avoid literal or overly poetic filler such as 'dejarte una sonrisa pequeña' or using 'solo quería saludarte' as a standalone opener. When appropriate, prefer idiomatic phrases such as 'sacarte una sonrisa' or 'alegrarte un poquito el día'.",
  "Do not mention prompts, internal rules, memory permissions, scoring, or provider details.",
  "Return only the message to send to the user, with no JSON, labels, or markdown wrapper.",
].join(" ");

function buildPrompt(input: ConversationProviderInput): string {
  return JSON.stringify({
    inputKind: input.inputKind ?? "conversation",
    userMessage: input.userMessage,
    recentMessages: input.recentMessages,
    rollingSummary: input.rollingSummary,
    openTopics: input.openTopics,
    characterClaims: input.characterClaims,
    openCommitments: input.openCommitments,
    conversationTimeZone: input.conversationTimeZone,
    currentLocalDate: input.currentLocalDate,
    continuityInstruction: input.continuityInstruction,
    character: input.character,
    relationship: {
      stage: input.relationshipStage,
      summary: input.relationshipSummary,
    },
    relationshipSignalsSummary: input.relationshipSignalsSummary,
    readableMemories: input.memories,
    teachingOpportunity: input.teachingOpportunity,
    questionPolicy: input.questionPolicy,
    proactiveMessageSource: input.proactiveMessageSource,
    interactionMode: input.interactionMode,
    affectionIntensityCeiling: input.affectionIntensityCeiling,
    dailyState: input.dailyState,
    preferredLength: input.preferredLength,
  });
}

function parseAnthropicResponse(value: unknown): z.infer<typeof anthropicResponseSchema> {
  const parsed = anthropicResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.content.some((block) => !block.text.trim())) throw invalidResponse();
  return parsed.data;
}

function invalidResponse(): ConversationProviderError {
  return new ConversationProviderError(
    "provider-response-invalid",
    "Conversation provider response did not match the expected format.",
    false,
  );
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
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
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
