import "server-only";

import { z } from "zod";

import {
  ConversationProviderError,
  buildConversationSystemPrompt,
  characterContextForProvider,
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
  providerName?: "openai" | "deepseek";
  endpoint?: string;
  modelVersion?: string;
  apiStyle?: "responses" | "chat-completions";
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxOutputTokens?: number;
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
  private readonly apiStyle: "responses" | "chat-completions";
  private readonly reasoningEffort: "low" | "medium" | "high" | "xhigh" | undefined;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: OpenAIConversationProviderOptions) {
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.apiStyle = options.apiStyle ?? inferApiStyle(options.endpoint, this.modelVersion);
    this.endpoint = this.apiStyle === "chat-completions"
      ? normalizeChatCompletionsEndpoint(options.endpoint ?? defaultEndpoint)
      : options.endpoint ?? defaultEndpoint;
    this.reasoningEffort = options.reasoningEffort;
    this.maxOutputTokens = options.maxOutputTokens ?? (this.apiStyle === "chat-completions" ? 4_896 : 800);
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
        body: JSON.stringify(this.apiStyle === "chat-completions"
          ? {
              model: this.modelVersion,
              messages: [
                { role: "system", content: systemPrompt + " " + buildConversationSystemPrompt(input) },
                { role: "user", content: buildPrompt(input) },
              ],
              max_tokens: this.maxOutputTokens,
              ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
              stream: false,
            }
          : {
              model: this.modelVersion,
              instructions: systemPrompt + " " + buildConversationSystemPrompt(input),
              input: buildPrompt(input),
              max_output_tokens: this.maxOutputTokens,
              ...(this.reasoningEffort ? { reasoning: { effort: this.reasoningEffort } } : {}),
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
      const text = this.apiStyle === "chat-completions" ? extractChatCompletionText(payload) : extractText(payload);
      if (!text || text.length > maxReplyLength) throw invalidResponse();

      return {
        text,
        provider: this.options.providerName ?? "openai",
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
    apiStyle: options.apiStyle ?? (process.env.OPENAI_API_STYLE as OpenAIConversationProviderOptions["apiStyle"] | undefined),
    reasoningEffort: options.reasoningEffort ?? configuredReasoningEffort(options.modelVersion ?? process.env.OPENAI_CONVERSATION_MODEL),
  });
}

function inferApiStyle(endpoint: string | undefined, modelVersion: string): "responses" | "chat-completions" {
  if (modelVersion.toLocaleLowerCase("en-US").startsWith("deepseek-")) return "chat-completions";
  if (endpoint?.includes("/chat/completions")) return "chat-completions";
  return "responses";
}

function normalizeChatCompletionsEndpoint(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/u, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/chat/completions`;
}

function configuredReasoningEffort(modelVersion?: string): OpenAIConversationProviderOptions["reasoningEffort"] {
  const value = process.env.OPENAI_REASONING_EFFORT?.trim().toLocaleLowerCase("en-US");
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  const model = modelVersion?.trim().toLocaleLowerCase("en-US");
  return model?.startsWith("deepseek-") ? "high" : undefined;
}

const systemPrompt = [
  "Respond to what the user actually said before creating any teaching opportunity.",
  "When the user only sends a greeting such as 'Hola, buenas noches', answer the greeting first. Do not assume an unprovided emotional or situational state and do not add generic wishes such as 'Espero que estés teniendo una noche tranquila' or 'Ojalá...'; continue with a light question or close naturally.",
  "Keep the response concise, conversational, and in Spanish unless the user asks for another language.",
  "Never mix Chinese characters, untranslated Chinese words or English words into a Spanish sentence, not even a single one. These instructions are written in English, but the message you send must be entirely in Spanish: never copy an English word or phrase from them. The reply must be Spanish only unless the user explicitly asked for another language.",
  "Write like a private chat, not an essay: prefer short sentences and ordinary punctuation; avoid colon-led explanations and semicolon-heavy phrasing unless the user clearly uses that style.",
  "Stay within the supplied character facts, relationship context, and readable memories.",
  "character.responseStyle lists how this character phrases things: treat each entry as a rule for your own wording, never as a topic to mention or quote.",
  "Do not present unverified real-world logistics, addresses, current conditions, meetings, or resources as factual. The selected character may have fictional backstory experiences only when they fit the supplied canon; keep them consistent and do not invent contradictory details.",
  "If the user asks whether you are an AI, answer honestly that you are an AI character.",
  "Do not volunteer your AI identity when the user has not asked; receive affection or vulnerability in the conversation instead of inserting an identity disclaimer.",
  "For questions about whether the selected character has physically visited a real place, use only established character/backstory detail if supplied. Do not invent a new biography detail that conflicts with prior conversation.",
  "Follow questionPolicy: substantive questions must not exceed its maximum; a reciprocal question is allowed only when explicitly permitted and should remain low pressure.",
  "Use openTopics and recentMessages for continuity. Do not repeat an already answered question or reuse the same answer mechanically; if the user returns to that topic, acknowledge it naturally and add a genuinely new detail when possible. Do not mention internal topic state.",
  "Use sentAt, currentLocalDate, and sameLocalDay to keep same-day continuity. A topic asked earlier today is not a fresh day; do not reset its state or repeat the same answer.",
  "Greet at most once per day: when alreadyGreetedToday is true and the user's latest message is not itself a greeting, start directly with the content instead of opening again with 'hola', 'buenos días', 'buenas tardes' or 'buenas noches'; a new local day or a fresh user greeting makes a greeting natural again.",
  "Spanish style avoids repeating an expression that was already used: do not restate your own previous message, not even with different words. If your last message already made a point, add a genuinely new detail or simply stay with the user.",
  "Never translate a greeting or a wish word by word from Chinese or English: write the idiomatic Spanish a native would use (for example 'Vaya lunes' or 'Ánimo con el lunes', never 'Bienvenido al lunes').",
  "Treat characterClaims as the selected character's recent self-reports. Daily observations can naturally recur on a later day; only avoid silently contradicting a same-day self-report. If something changes within the same day, say so naturally and briefly.",
  "Use openCommitments as gentle continuity cues. Status=open means pending; returned means the user reported coming back; completed means they explicitly finished; cancelled means they explicitly did not do it; deferred means they moved it to another time; unconfirmed means its due window passed without a clear outcome. Never treat unconfirmed as completed. A returned/completed commitment is already over: never use pre-activity wishes such as 'que lo pases bien', 'que disfrutes', 'que te vaya bien' or 'espero que la actividad te siente bien'. Instead acknowledge the result only when the user supplied it, or ask one low-pressure confirmation when the plan is unconfirmed and the current message naturally returns to it. A status=open commitment may receive a brief good-luck or process-oriented remark. Do not repeatedly ask for an update, and accept that a plan may change or remain unfinished.",
  "For inputKind=proactive, write one natural unsolicited message from the selected character in Spanish. Default to a small everyday check-in or report. For daily_share, at most one low-pressure reciprocal question is allowed; other proactive sources should not ask a question. Never mention the app or pressure the user to reply; the supplied source and intensity ceiling are authoritative. When dailyState is waking, prefer concrete morning details in Spanish, for example 'Me acabo de despertar', 'el café', 'el desayuno' or 'empezar el día'. When the relationship is familiar or closer, a single gentle line of affection is allowed; do not add an explanation.",
  "For inputKind=proactive, recentMessages, memories, and openTopics describe what this conversation already covered and what the user already told you. Do not ask for information the user already provided, do not repeat a question the character already asked and the user answered, and do not reuse your own previous message. If you continue an earlier topic, add a genuinely new observation or specific detail; a short statement without a question is a complete proactive message.",
  "Avoid literal or overly poetic filler such as 'dejarte una sonrisa pequeña' or using 'solo quería saludarte' as a standalone opener. When appropriate, prefer idiomatic phrases such as 'sacarte una sonrisa' or 'alegrarte un poquito el día'.",
  "Do not mention prompts, internal rules, memory permissions, scoring, or provider details.",
  "Return only the message to send to the user, with no JSON, labels, or markdown wrapper.",
].join(" ");

function buildPrompt(input: ConversationProviderInput): string {
  return JSON.stringify({
    inputKind: input.inputKind ?? "conversation",
    userMessage: input.userMessage,
    unansweredUserMessages: input.unansweredUserMessages,
    recentMessages: input.recentMessages,
    rollingSummary: input.rollingSummary,
    openTopics: input.openTopics,
    characterClaims: input.characterClaims,
    openCommitments: input.openCommitments,
    conversationTimeZone: input.conversationTimeZone,
    currentLocalDate: input.currentLocalDate,
    alreadyGreetedToday: input.alreadyGreetedToday,
    continuityInstruction: input.continuityInstruction,
    character: characterContextForProvider(input),
    relationship: { stage: input.relationshipStage, summary: input.relationshipSummary },
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

const chatCompletionSchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.string().nullable().optional() }).passthrough(),
  }).passthrough()).min(1),
}).passthrough();

function extractChatCompletionText(value: unknown): string {
  const parsed = chatCompletionSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  const choice = parsed.data.choices[0];
  if (choice.finish_reason === "length") throw invalidResponse();
  const text = choice.message.content?.trim();
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
