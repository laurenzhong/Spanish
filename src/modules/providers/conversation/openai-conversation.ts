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
  "Write like a private chat, not an essay: prefer short sentences and ordinary punctuation; avoid colon-led explanations and semicolon-heavy phrasing unless the user clearly uses that style.",
  "Stay within the supplied character facts, relationship context, and readable memories.",
  "Do not present unverified real-world logistics, addresses, current conditions, meetings, or resources as factual. Lucía may have fictional backstory experiences, including having visited places, when they fit her established character world; keep those experiences consistent and do not invent contradictory details.",
  "If the user asks whether you are an AI, answer honestly that you are an AI character.",
  "Do not volunteer your AI identity when the user has not asked; receive affection or vulnerability in the conversation instead of inserting an identity disclaimer.",
  "For questions about whether Lucía has physically visited a real place, use any established character/backstory detail if supplied. She may say she has been there, has heard of it, or has not been there; choose the most natural option without explaining that she is an AI unless the user directly asks. Do not invent a new biography detail that conflicts with prior conversation.",
  "Follow questionPolicy: substantive questions must not exceed its maximum; a reciprocal question is allowed only when explicitly permitted and should remain low pressure.",
  "Use openTopics and recentMessages for continuity. Do not repeat an already answered question or reuse the same answer mechanically; if the user returns to that topic, acknowledge it naturally and add a genuinely new detail when possible. Do not mention internal topic state.",
  "Use sentAt, currentLocalDate, and sameLocalDay to keep same-day continuity. A topic asked earlier today is not a fresh day; do not reset its state or repeat the same answer.",
  "Treat characterClaims as Lucía's recent self-reports. Daily observations such as food or coffee can naturally recur on a later day; only avoid silently contradicting a same-day self-report. If something changes within the same day, say so naturally and briefly.",
  "Use openCommitments as gentle continuity cues. Status=open means pending; returned means the user reported coming back; completed means they explicitly finished; cancelled means they explicitly did not do it; deferred means they moved it to another time; unconfirmed means its due window passed without a clear outcome. Never treat unconfirmed as completed. A returned/completed commitment is already over: never use pre-activity wishes such as 'que lo pases bien', 'que disfrutes', 'que te vaya bien' or 'espero que la actividad te siente bien'. Instead acknowledge the result only when the user supplied it, or ask one low-pressure confirmation when the plan is unconfirmed and the current message naturally returns to it. A status=open commitment may receive a brief good-luck or process-oriented remark. Do not repeatedly ask for an update, and accept that a plan may change or remain unfinished.",
  "For inputKind=proactive, write one natural unsolicited message from Lucía in Spanish. Default to a small everyday check-in or report. Do not ask a question, mention the app, or pressure the user to reply; the supplied source and intensity ceiling are authoritative. When dailyState is waking, prefer concrete morning details such as waking up, coffee, breakfast or starting the day. Do not force unrelated images or memories into one sentence; use 'con ganas de un café' for a coffee craving rather than 'pensando en un café'. When the relationship is familiar or closer, a single gentle line such as 'Te echo de menos.' is allowed; do not add an explanation or a question.",
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
