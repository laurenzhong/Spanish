/**
 * Provider-independent interface for the private in-chat learning assistant
 * (CHAT-ASSISTANT-001).
 *
 * The assistant is a study tool, not a conversation participant: it is called
 * with the learner's own question or draft plus a read-only slice of the
 * learner's conversation context, and it returns a structured explanation.
 * Nothing in this module writes messages, memories, relationship state or
 * learning evidence.
 */

export const conversationAssistantProviderErrorCodes = [
  "input-invalid",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
] as const;

export type ConversationAssistantProviderErrorCode =
  (typeof conversationAssistantProviderErrorCodes)[number];

/**
 * The four learning tasks the assistant supports. This is intentionally a
 * local union instead of an import from the conversation DTO module: the
 * providers layer stays independent of a single consuming feature, and the
 * application layer maps between the two structurally identical unions.
 */
export const assistantProviderIntents = ["reply", "grammar", "structure", "question"] as const;

export type AssistantProviderIntent = (typeof assistantProviderIntents)[number];

export type ConversationAssistantProviderMessage = Readonly<{
  role: "user" | "assistant";
  text: string;
}>;

export type ConversationAssistantProviderInput = Readonly<{
  intent: AssistantProviderIntent;
  /** Free-form learner question; null for intents that do not ask one. */
  question: string | null;
  /** Sentence to check or analyse; null is only valid where a fallback exists. */
  targetText: string | null;
  /**
   * CHAT-ASSISTANT-003: the deterministic sense groups the application already
   * cut from targetText, in order. Non-empty only for `structure`; the
   * provider must return exactly one structure annotation per entry and must
   * never decide its own segmentation.
   */
  senseGroups: readonly string[];
  characterDisplayName: string;
  /** Read-only completed, non-withdrawn context from the learner's own chat. */
  recentMessages: readonly ConversationAssistantProviderMessage[];
}>;

export type ConversationAssistantStructuredResult = Readonly<{
  /** Simplified-Chinese explanation; the one mandatory output block. */
  answer: string;
  suggestions: readonly Readonly<{ spanish: string; chinese: string }>[];
  corrections: readonly Readonly<{
    original: string;
    corrected: string;
    explanation: string;
  }>[];
  /**
   * Aligned one-to-one, in the same order as `input.senseGroups`: `fragment`
   * is always the application's deterministic sense group, never the model's
   * own split.
   */
  structure: readonly Readonly<{ fragment: string; role: string; explanation: string }>[];
  correctedSentence: string | null;
}>;

export type ConversationAssistantProviderResult = ConversationAssistantStructuredResult &
  Readonly<{
    provider: "minimax" | "fake";
    modelVersion: string;
    providerRequestId: string | null;
    latencyMs: number;
    estimatedCostMicros: number | null;
  }>;

export interface ConversationAssistantProvider {
  assist(
    input: ConversationAssistantProviderInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<ConversationAssistantProviderResult>;
}

export class ConversationAssistantProviderError extends Error {
  readonly code: ConversationAssistantProviderErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ConversationAssistantProviderErrorCode,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "ConversationAssistantProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** Bounds mirror the public DTO and the repository context projection. */
export const maxAssistantSenseGroups = 12;
const maxSenseGroupLength = 2_000;

export function validateConversationAssistantProviderInput(
  input: ConversationAssistantProviderInput,
): void {
  const question = input.question;
  const targetText = input.targetText;
  const senseGroups = input.senseGroups;
  const senseGroupsValid =
    Array.isArray(senseGroups) &&
    (input.intent === "structure"
      ? senseGroups.length >= 1 &&
        senseGroups.length <= maxAssistantSenseGroups &&
        senseGroups.every(
          (group) => typeof group === "string" && group.trim().length > 0 && group.length <= maxSenseGroupLength,
        )
      : senseGroups.length === 0);
  const invalid =
    !assistantProviderIntents.includes(input.intent) ||
    typeof input.characterDisplayName !== "string" ||
    !input.characterDisplayName.trim() ||
    input.characterDisplayName.length > 120 ||
    (question !== null &&
      (typeof question !== "string" || !question.trim() || question.length > 800)) ||
    (targetText !== null &&
      (typeof targetText !== "string" || !targetText.trim() || targetText.length > 2_000)) ||
    (input.intent === "grammar" && !targetText) ||
    (input.intent === "structure" && !targetText) ||
    !senseGroupsValid ||
    (input.intent === "question" && !question) ||
    !Array.isArray(input.recentMessages) ||
    input.recentMessages.length > 8 ||
    input.recentMessages.some(
      (message) =>
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.text !== "string" ||
        !message.text.trim() ||
        message.text.length > 2_000,
    );
  if (invalid) {
    throw new ConversationAssistantProviderError(
      "input-invalid",
      "Conversation assistant input is invalid.",
      false,
    );
  }
}
