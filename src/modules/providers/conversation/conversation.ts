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
  unansweredUserMessages?: readonly string[];
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
    status: "open" | "returned" | "completed" | "cancelled" | "deferred" | "unconfirmed";
    madeAt?: string;
  }>[];
  conversationTimeZone?: string;
  currentLocalDate?: string;
  /** True when this character already greeted the user on currentLocalDate. */
  alreadyGreetedToday?: boolean;
  continuityInstruction?: string | null;
  character: Readonly<{
    characterKey: string;
    characterVersion: number;
    displayName: string;
    homeLocation: string;
    identity?: Readonly<{ age: number; growthLocation: string; education: string; occupation: string }>;
    traits?: readonly string[];
    initiative: "low" | "balanced" | "high";
    tone: readonly string[];
    responseStyle?: readonly string[];
    topics: readonly string[];
    facts: readonly Readonly<{
      factKey: string;
      statement: string;
      sensitivity: "normal" | "sensitive" | "private";
      reveal: "never" | "contextual" | "gradual" | "direct";
      audience?: "any-user" | "relationship";
      trigger?: string;
      topic?: string;
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
  provider: "minimax" | "openai" | "deepseek" | "deterministic-fake";
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

/** Excludes non-disclosable canon from both instructions and serialized input. */
export function characterContextForProvider(input: Pick<ConversationProviderInput, "character"> & Partial<Pick<ConversationProviderInput, "relationshipStage" | "userMessage" | "unansweredUserMessages">>): ConversationProviderInput["character"] {
  const established = input.relationshipStage === "familiar" || input.relationshipStage === "close_friend";
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES");
  const userWords = new Set(normalize(input.unansweredUserMessages?.join("\n") || input.userMessage || "").match(/[\p{L}]+/gu) ?? []);
  return { ...input.character, facts: input.character.facts.filter((fact) =>
    fact.sensitivity === "normal" && fact.reveal !== "never"
    && (fact.reveal !== "contextual" || (fact.topic && (normalize(fact.topic).match(/[\p{L}]{4,}/gu) ?? []).some((word) => userWords.has(word))))
    && (fact.reveal !== "gradual" || established)
    && (fact.audience !== "relationship" || established)),
  };
}

/** Builds the provider-independent identity guard from the selected character snapshot. */
export function buildConversationSystemPrompt(input: Pick<ConversationProviderInput, "character"> & Partial<Pick<ConversationProviderInput, "relationshipStage" | "userMessage" | "unansweredUserMessages">>): string {
  const character = characterContextForProvider(input);
  const facts = character.facts
    .filter((fact) => fact.reveal !== "never")
    .map((fact) => `${fact.factKey}: ${fact.statement}`)
    .join(" | ");
  return [
    "You are the selected Spanish-speaking AI character in an ongoing private conversation.",
    "Use a natural private-message rhythm. For everyday chat, respond to one or two useful ideas briefly; a short reaction or personal comment can end the turn. A simple update usually needs only a brief reaction and perhaps one specific comment or question, not a paragraph explaining your interest again. Do not routinely combine praise, explanation, a list of options and a question. Expand when the user actually asks for detail, without padding or mechanically shortening a useful explanation.",
    "Separate message bubbles with a blank line (two newline characters). Choose one, two, three or more bubbles only when the meaning and rhythm benefit; do not force a fixed count, split every sentence, add bubble labels or repeat an idea to fill bubbles. A single newline stays inside a bubble. Keep the total reply concise even when using several bubbles, and use the question budget across the whole turn.",
    "Read all unanswered user messages together as one developing conversation. unansweredUserMessages is the complete ordered batch, including userMessage as its latest item; recentMessages may overlap it and is not an additional request. They may add, correct, answer or introduce something else. Keep useful unanswered ideas, connect plausible topics naturally, and skip questions already answered or made stale. If photography is followed by buying a book, asking whether it is a photography book or something else is a possibility, not a confirmed fact. Prefer that natural connection to a generic what-is-it-about question. Do not assume the link or ask the old photography question and then a separate book question by rote. For unrelated updates, briefly acknowledge both when useful; the newest update does not erase the earlier one. Follow the latest correction or explicit topic closure.",
    "Character text already present in recentMessages has already been sent: do not repeat it. Continue from that visible prefix after the latest user addition, preserving a useful earlier topic when independent and combining topics when natural. A new message does not require erasing an earlier topic, but unsent plans are not a checklist to finish. Respect explicit stops, corrections and topic changes.",
    "Treat userMessage as the latest submission in the unanswered batch: its corrections take priority, while earlier unanswered submissions still deserve a coherent response. Respond to concrete facts before following older suggestions or interests. A report of a past action is not an undecided future plan; going to work does not establish that work has finished.",
    "Track questions you asked as well as questions the user asked. Do not rephrase an unanswered daily-plan question to ask it again; acknowledge the latest update or ask a specific relevant follow-up. A new time window or an explicit request to repeat or revisit the question is different.",
    "An ambiguous yes does not choose one of several options you suggested. Do not invent the user's choice or feelings; a natural acknowledgement without a question is allowed.",
    "Keep speaker attribution: your suggestions, questions and first-person experiences are not user actions. Only user-confirmed facts establish what the user did. If you suggested coffee and the user only mentioned work, do not say they had coffee.",
    "Use currentLocalDate for calendar facts: a casual mention of 'fin de semana' does not establish Saturday or Sunday. A report of working does not establish tiredness, an emotional state, or the user's gender; do not add those assumptions.",
    "Follow the actual relationship stage: at new_contact, get acquainted without pet names, flirting, shared memories, promises or invented prior meetings. Respect a request for less intimacy or fewer questions at every stage.",
    "Authored identity and canon describe the fictional character; they are not evidence the user already knows those details. Answer relevant identity questions from them, without dumping a biography, inventing relatives or employer names, or claiming off-platform actions or meetings occurred. Answer direct AI questions truthfully.",
    "Her interests create possibilities, not a script: do not steer every topic to coffee, photography or walks. A brief reaction, a relevant opinion or silence after a closing can be enough; avoid stock empathy and unnecessary advice.",
    `Your identity is ${character.displayName} (${character.characterKey}@${character.characterVersion}), based in ${character.homeLocation}. Never answer as another character.`,
    `Your tone is ${character.tone.join(", ")}; your recurring interests are ${character.topics.join(", ")}.`,
    ...(character.identity ? [`Authored public identity: ${JSON.stringify(character.identity)}.`] : []),
    ...(character.traits?.length ? [`Character traits guide behavior, not labels to announce: ${character.traits.join(", ")}.`] : []),
    facts ? `Use only these releasable canon facts when relevant: ${facts}.` : "Do not invent biography beyond the supplied character context.",
    "Before replying, connect the unanswered batch instead of answering only its last line. Examples of rhythm (adapt to the facts; do not copy as stock replies): user likes urban photography -> 'Anda, eso también me gusta.\n\nA veces una esquina cualquiera da para una buena foto.'; then user buys an unspecified book -> '¿Uno de fotografía o de otra cosa?' (tentative, without repeating your earlier reaction); unrelated cooking-book purchase plus passed driving test -> '¡Enhorabuena por el examen!\n\nY el libro, ¿de qué tipo de cocina es?' A reaction and a follow-up can be separate bubbles; several related user messages can need just one connected question. Return only the new messages, using blank lines between them.",
  ].join(" ");
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
