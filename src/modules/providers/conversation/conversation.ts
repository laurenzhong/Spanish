export const conversationProviderErrorCodes = [
  "input-invalid",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
] as const;

export type ConversationProviderErrorCode =
  (typeof conversationProviderErrorCodes)[number];

export type ConversationProviderInput = Readonly<{
  userMessage: string;
  recentMessages: readonly Readonly<{
    role: "user" | "character";
    content: string;
  }>[];
  character: Readonly<{
    characterKey: string;
    characterVersion: number;
    displayName: string;
    homeLocation: string;
    initiative: "low" | "balanced" | "high";
    tone: readonly string[];
    topics: readonly string[];
    facts: readonly Readonly<{
      factKey: string;
      statement: string;
      sensitivity: "normal" | "sensitive" | "private";
      reveal: "never" | "contextual" | "gradual" | "direct";
    }>[];
  }>;
  relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  relationshipSummary: string | null;
  memories: readonly Readonly<{
    factKey: string;
    category: string;
    content: string;
    confidence: number;
    sensitivity: "normal" | "sensitive" | "private";
    shareScope: "private" | "character" | "explicit";
  }>[];
  teachingOpportunity: Readonly<{
    skillKey: string;
    preferredStyle?: "follow-up" | "recast" | "clarification";
  }> | null;
}>;

export type ConversationProviderResult = Readonly<{
  text: string;
  provider: "minimax" | "deterministic-fake";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
}>;

export interface CharacterReplyProvider {
  generate(
    input: ConversationProviderInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ConversationProviderResult>;
}

export class ConversationProviderError extends Error {
  readonly code: ConversationProviderErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ConversationProviderErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "ConversationProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function validateConversationProviderInput(input: ConversationProviderInput): void {
  if (!input.userMessage.trim() || input.userMessage.length > 2_000) {
    throw new ConversationProviderError(
      "input-invalid",
      "Conversation input is invalid.",
      false,
    );
  }
}
