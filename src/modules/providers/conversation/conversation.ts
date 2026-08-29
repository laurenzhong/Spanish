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
  inputKind?: "conversation" | "proactive";
  userMessage: string;
  recentMessages: readonly Readonly<{
    role: "user" | "character";
    content: string;
    sentAt?: string;
  }>[];
  rollingSummary?: string | null;
  openTopics?: readonly Readonly<{
    topicKey: string;
    label: string;
    status: "open" | "answered" | "closed";
    lastMentionedBy: "user" | "character";
    lastAnswer?: string;
    lastAskedAt?: string;
    lastAnsweredAt?: string;
    sameLocalDay?: boolean;
  }>[];
  characterClaims?: readonly Readonly<{
    claimKey: string;
    claimKind: "daily_observation" | "short_plan" | "current_state";
    statement: string;
    assertedAt?: string;
    sameLocalDay?: boolean;
    repeatableOnLaterDays: boolean;
  }>[];
  openCommitments?: readonly Readonly<{
    commitmentKey: string;
    owner: "user" | "character";
    statement: string;
    dueHint: "later-today" | "tomorrow" | "unspecified";
    status: "open" | "returned";
    madeAt?: string;
  }>[];
  conversationTimeZone?: string;
  currentLocalDate?: string;
  continuityInstruction?: string | null;
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
  relationshipSignalsSummary?: string | null;
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
  questionPolicy?: Readonly<{
    maxSubstantiveQuestions: number;
    allowReciprocalQuestion: boolean;
    maxQuestionPressure: "none" | "low" | "medium";
  }>;
  proactiveMessageSource?:
    | "spontaneous_affection"
    | "memory_callback"
    | "follow_up_commitment"
    | "daily_share"
    | "relationship_milestone"
    | "quiet_presence";
  interactionMode?: "everyday" | "quiet" | "affectionate" | "closing" | "playful" | "supportive";
  affectionIntensityCeiling?: 0 | 1 | 2 | 3;
  dailyState?: "available" | "waking" | "having-breakfast" | "awake-late";
  preferredLength?: "one-line" | "short";
}>;

export type ConversationProviderResult = Readonly<{
  text: string;
  provider: "minimax" | "openai" | "deterministic-fake";
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
  const missingMessage = input.inputKind !== "proactive" && !input.userMessage.trim();
  if (missingMessage || input.userMessage.length > 2_000) {
    throw new ConversationProviderError(
      "input-invalid",
      "Conversation input is invalid.",
      false,
    );
  }
}
