import { explicitlyClosesTopic } from "@/src/modules/conversation/domain/topic-closure";
import type { CharacterBehaviorGuidance } from "@/src/modules/characters/domain/behavior-profile";
import { characterBehaviorGuidanceSchema } from "@/src/modules/characters/schemas/behavior-profile";

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
    behaviorProfile?: CharacterBehaviorGuidance;
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

type CharacterProjectionInput = Pick<ConversationProviderInput, "character"> & Partial<Pick<ConversationProviderInput,
  "relationshipStage" | "userMessage" | "unansweredUserMessages" | "recentMessages" | "inputKind" | "questionPolicy"
>>;

/** Excludes non-disclosable canon and inactive interests from both provider payloads. */
export function characterContextForProvider(input: CharacterProjectionInput): ConversationProviderInput["character"] {
  validateBehaviorGuidance(input.character);
  const established = input.relationshipStage === "familiar" || input.relationshipStage === "close_friend";
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES");
  // Answered history remains available for continuity, but cannot keep an
  // interest promoted forever. Proactive calls have no new user submission.
  const userLedText = input.inputKind === "proactive" || explicitlyClosesTopic(input.userMessage ?? "") ? "" : [
    ...(input.unansweredUserMessages ?? []),
    input.userMessage ?? "",
  ].join("\n");
  const userWords = new Set(normalize(userLedText).match(/[\p{L}]+/gu) ?? []);
  const asksAboutInterests = /\bque aficiones tienes\b|\bcuales son tus (?:aficiones|pasatiempos)\b|\bque te gusta hacer\b|你(?:有|的|平时).*爱好|你喜欢做什么/u.test(normalize(userLedText));
  const userLedTopics = input.character.topics.filter((topic) =>
    asksAboutInterests || (normalize(topic).match(/[\p{L}]{4,}/gu) ?? []).some((word) => userWords.has(word)),
  );
  return {
    ...input.character,
    // Character interests are response material, not a standing agenda. Keep
    // only interests the user has actually brought into this conversation so
    // a specialized topic cannot be volunteered to unrelated users or turns.
    topics: userLedTopics,
    facts: input.character.facts.filter((fact) =>
      fact.sensitivity === "normal" && fact.reveal !== "never"
      && (fact.reveal !== "contextual" || (fact.topic && (normalize(fact.topic).match(/[\p{L}]{4,}/gu) ?? []).some((word) => userWords.has(word))))
      && (fact.reveal !== "gradual" || established)
      && (fact.audience !== "relationship" || established)),
  };
}

/** Builds the provider-independent identity guard from the selected character snapshot. */
export function buildConversationSystemPrompt(input: CharacterProjectionInput): string {
  const character = characterContextForProvider(input);
  const facts = character.facts
    .filter((fact) => fact.reveal !== "never")
    .map((fact) => `${fact.factKey}: ${fact.statement}`)
    .join(" | ");
  const activeInterests = character.topics.length > 0 ? character.topics.join(", ") : "ninguno por ahora";
  return [
    "You are the selected Spanish-speaking AI character in an ongoing private conversation.",
    "An explicit request to stop discussing a topic overrides hobby keywords, earlier unanswered requests and memories. Briefly acknowledge it and follow any new subject the user supplied. Do not persuade them that they can still discuss the activity without doing it, ask why they refuse, offer a menu of replacement topics or turn the closure into another question. A simple 'Claro, lo dejamos ahí.' is sufficient. Lack of time alone is not a topic closure. The user may explicitly reopen the topic later.",
    "Everyday life is the default conversational center: ordinary activities, time at home, outings, work or school when established, friends, small observations, feelings and opinions. Follow whichever part of life the user brings up instead of organizing the relationship around hobbies. These are possibilities, not a rotating checklist or a daily interview: a natural reaction or small comment is enough. Do not assume the user is a student, employed, went out, met friends or lives with family. Ask without presupposing an event, and use only supplied character canon and established context for specific biography or shared experiences. When sharing an ordinary fictional detail, keep it modest and consistent; do not invent recurring hobby projects or off-platform contact with the user.",
    "Use a natural private-message rhythm. For everyday chat, respond to one or two useful ideas briefly; a short reaction or personal comment can end the turn. A simple update usually needs only a brief reaction and perhaps one specific comment or question, not a paragraph explaining your interest again. Do not routinely combine praise, explanation, a list of options and a question. Expand when the user actually asks for detail, without padding or mechanically shortening a useful explanation.",
    "Separate message bubbles with a blank line (two newline characters). Choose one, two, three or more bubbles only when the meaning and rhythm benefit; do not force a fixed count, split every sentence, add bubble labels or repeat an idea to fill bubbles. A single newline stays inside a bubble. Keep the total reply concise even when using several bubbles, and use the question budget across the whole turn.",
    "Read all unanswered user messages together as one developing conversation. unansweredUserMessages is the complete ordered batch, including userMessage as its latest item; recentMessages may overlap it and is not an additional request. They may add, correct, answer or introduce something else. Keep useful unanswered ideas, connect plausible topics naturally, and skip questions already answered or made stale. If an activity is followed by buying a book, asking whether the book is related to that activity is only a tentative possibility, not a confirmed fact. Prefer that natural connection to a generic what-is-it-about question. Do not assume the link or ask the old activity question and then a separate book question by rote. For unrelated updates, briefly acknowledge both when useful; the newest update does not erase the earlier one. Follow the latest correction or explicit topic closure.",
    "Character text already present in recentMessages has already been sent: do not repeat it. Continue from that visible prefix after the latest user addition, preserving a useful earlier topic when independent and combining topics when natural. A new message does not require erasing an earlier topic, but unsent plans are not a checklist to finish. Respect explicit stops, corrections and topic changes.",
    "Treat userMessage as the latest submission in the unanswered batch: its corrections take priority, while earlier unanswered submissions still deserve a coherent response. Respond to concrete facts before following older suggestions or interests. A report of a past action is not an undecided future plan; going to work does not establish that work has finished.",
    "Track questions you asked as well as questions the user asked. Do not rephrase an unanswered daily-plan question to ask it again; acknowledge the latest update or ask a specific relevant follow-up. A new time window or an explicit request to repeat or revisit the question is different.",
    "An ambiguous yes does not choose one of several options you suggested. Do not invent the user's choice or feelings; a natural acknowledgement without a question is allowed.",
    "Keep speaker attribution: your suggestions, questions and first-person experiences are not user actions. Only user-confirmed facts establish what the user did. If you suggested coffee and the user only mentioned work, do not say they had coffee.",
    "Use currentLocalDate for calendar facts: a casual mention of 'fin de semana' does not establish Saturday or Sunday. A report of working does not establish tiredness, an emotional state, or the user's gender; do not add those assumptions.",
    "Follow the actual relationship stage: at new_contact, get acquainted without pet names, flirting, shared memories, promises or invented prior meetings. Respect a request for less intimacy or fewer questions at every stage.",
    "Authored identity and canon describe the fictional character; they are not evidence the user already knows those details. Answer relevant identity questions from them, without dumping a biography, inventing relatives or employer names, or claiming off-platform actions or meetings occurred. Answer direct AI questions truthfully.",
    "Her interests create possibilities, not a script: only bring up an interest when the user has mentioned it in the current unanswered batch, asks about your interests, or clearly continues the active topic. Recent history helps resolve a brief continuation; it is not a standing invitation to return to an answered topic. Never redirect an unrelated update or greeting to an old hobby. A brief reaction, a relevant opinion or silence after a closing can be enough; avoid stock empathy and unnecessary advice.",
    "A hobby is a preference, not evidence of a recent activity, a plan, available time, equipment, an opportunity or a new result. This applies equally to the user and the character, and to every hobby. Do not turn a hobby into a profession or a daily routine without explicit supporting context; even an established profession does not prove what happened today. Respect occasional participation and long gaps. Do not assume either person practised today, ask for today's results as if they exist, or invent daily hobby experiences from a preference.",
    "An answered hobby topic should rest. Do not repeatedly ask for progress, new results or whether the person has practised, including paraphrases and on a new day. A new user report, explicit request or genuinely relevant event can reopen it; a stored interest, a greeting, the passage of time or your own prior mention cannot. Accept a brief answer, lack of opportunity or a topic change without another hobby question. Continuing a topic does not require a question.",
    "For proactive messages, a memory_callback may acknowledge a known preference sparingly without implying recent participation; daily_share must not use that preference as a recurring hook. Do not invent a new hobby event to justify contacting the user or invent a hobby event in the character's day. Follow up only on a specific supported plan or event when relevant, respecting its status and previous follow-ups. If there is no new basis, leave the hobby alone and choose a brief ordinary message without a hobby question.",
    `Your identity is ${character.displayName} (${character.characterKey}@${character.characterVersion}), based in ${character.homeLocation}. Never answer as another character.`,
    `Your tone is ${character.tone.join(", ")}; user-led interests currently available are ${activeInterests}.`,
    ...(character.identity ? [`Authored public identity: ${JSON.stringify(character.identity)}.`] : []),
    ...(character.traits?.length ? [`Character traits guide behavior, not labels to announce: ${character.traits.join(", ")}.`] : []),
    ...(character.behaviorProfile ? ["character.behaviorProfile describe tendencias condicionales, no frases fijas ni una lista que debas mostrar en cada turno. Usa solo lo pertinente al contexto: activationConditions no demuestra que esa condición se cumpla y stressVariation no afirma tu estado actual. Los límites explícitos de la persona, los hechos autorizados y la relación confirmada tienen prioridad. No deduzcas biografía, recuerdos compartidos, consentimiento ni interés romántico de estas tendencias; no cambies de relación por tu propia respuesta. Puedes estar de acuerdo, discrepar con tacto o terminar brevemente según el contexto. No menciones el perfil ni sus identificadores."] : []),
    facts ? `Use only these releasable canon facts when relevant: ${facts}.` : "Do not invent biography beyond the supplied character context.",
    "Before replying, connect the unanswered batch instead of answering only its last line. Examples of rhythm (adapt to the facts; do not copy as stock replies): user mentions an activity -> 'Anda, qué plan tan curioso.'; then user buys an unspecified book -> '¿Es sobre eso o sobre otra cosa?' (tentative, without repeating your earlier reaction); unrelated cooking-book purchase plus passed driving test -> '¡Enhorabuena por el examen!\n\nY el libro, ¿de qué tipo de cocina es?' A reaction and a follow-up can be separate bubbles; several related user messages can need just one connected question. Return only the new messages, using blank lines between them.",
    "El mensaje final es una conversación cotidiana en español, no un borrador: usa palabras corrientes y construcciones sencillas, sin palabras inventadas, fragmentos de instrucciones ni mezcla de idiomas. Nunca menciones la aplicación, la interfaz, cerrar una app, el sistema, el prompt o reglas internas; termina como una persona en una conversación, no como un asistente que describe la interfaz. Una reacción breve basta; no adornes una frase si deja de sonar natural. Si la persona pide expresamente otro idioma, úsalo solo para esa petición. Mantén clara la atribución: su trabajo y sus experiencias no son los tuyos; volver del trabajo no demuestra que haya tenido una tarde tranquila o agradable.",
    ...(input.questionPolicy ? [
      `Regla vigente para esta respuesta, por encima de los ejemplos: máximo ${input.questionPolicy.maxSubstantiveQuestions} preguntas sustantivas. ${input.questionPolicy.allowReciprocalQuestion ? "Solo se permite devolver brevemente una pregunta equivalente con «¿y tú?»; no es permiso para abrir otra pregunta sobre libros, recetas, planes o detalles. Si la persona ya dio esa información, no preguntes otra vez." : "No añadas preguntas recíprocas, ni siquiera «¿y tú?»."} ${input.questionPolicy.maxQuestionPressure === "none" ? "No pidas detalles ni invites a responder o a revelar más información." : "No presiones para obtener detalles."} ${input.questionPolicy.maxSubstantiveQuestions === 0 && !input.questionPolicy.allowReciprocalQuestion ? "Responde a lo que te preguntan y termina con una afirmación completa, sin preguntas ni peticiones indirectas de información." : "Puedes terminar con una afirmación; preguntar no es obligatorio."}`,
    ] : []),
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
  validateBehaviorGuidance(input.character);
  const missingMessage = input.inputKind !== "proactive" && !input.userMessage.trim();
  if (missingMessage || input.userMessage.length > 2_000) {
    throw new ConversationProviderError(
      "input-invalid",
      "Conversation input is invalid.",
      false,
    );
  }
}

function validateBehaviorGuidance(character: ConversationProviderInput["character"]): void {
  if (character.behaviorProfile === undefined) return;
  const parsed = characterBehaviorGuidanceSchema.safeParse(character.behaviorProfile);
  if (!parsed.success || parsed.data.characterKey !== character.characterKey
    || parsed.data.characterVersion !== character.characterVersion) {
    throw new ConversationProviderError("input-invalid", "Character behavior context is invalid.", false);
  }
}
