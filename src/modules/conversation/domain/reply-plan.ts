export const replyIntents = [
  "greeting",
  "answer-and-follow-up",
  "acknowledge-and-explore",
  "emotional-support",
  "identity-disclosure",
] as const;

export type ReplyIntent = (typeof replyIntents)[number];
export type ReplyEmotion = "warm" | "curious" | "supportive" | "honest" | "neutral";
export type ReplyLength = "brief" | "balanced" | "expanded";
export type RelationshipStage = "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";

export type LearningOpportunity = Readonly<{
  skillKey: string;
  style: "follow-up" | "recast" | "clarification";
  reason: "natural-opening";
}>;

export type QuestionPolicy = Readonly<{
  maxSubstantiveQuestions: number;
  allowReciprocalQuestion: boolean;
  maxQuestionPressure: "none" | "low" | "medium";
}>;

export function questionPolicyForReply(input: Readonly<{ userMessage: string }>): QuestionPolicy {
  const text = normalized(input.userMessage);
  if (/(?:eres|es)\s+(?:una?\s+)?(?:ia|bot|persona real)|inteligencia artificial|eres real/iu.test(text)) {
    return { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" };
  }
  if (/\b(?:triste|preocupad[oa]|ansios[oa]|cansad[oa]|fatal|mal|problema|dif[ií]cil|queja|agobiad[oa])\b/iu.test(text)) {
    return { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" };
  }
  if (/\b(?:me voy|nos vemos|hasta luego|hasta manana|hasta mañana|buenas noches)\b/iu.test(text)) {
    return { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" };
  }
  if (/\b(?:me gustas|me encantas|creo que me gustas|me he enamorado|me estoy enamorando)\b/iu.test(text)) {
    return { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" };
  }
  if (text.includes("?") || /^(?:hola|hey|buenas)\b/iu.test(text)) {
    return { maxSubstantiveQuestions: 0, allowReciprocalQuestion: true, maxQuestionPressure: "low" };
  }
  return { maxSubstantiveQuestions: 1, allowReciprocalQuestion: true, maxQuestionPressure: "low" };
}

export type ReplyPlan = Readonly<{
  intent: ReplyIntent;
  emotion: ReplyEmotion;
  relationshipStage: RelationshipStage;
  shouldAskFollowUp: boolean;
  shouldShareExperience: boolean;
  shouldSuggestTopic: boolean;
  shouldSuggestPlace: boolean;
  shouldChangeTopic: boolean;
  length: ReplyLength;
  learningOpportunity: LearningOpportunity | null;
  rationale:
    | "answer-directly"
    | "respond-to-emotion"
    | "continue-shared-topic"
    | "keep-the-door-open"
    | "be-transparent-about-identity";
}>;

export type ReplyPlanningInput = Readonly<{
  userMessage: string;
  relationshipStage?: RelationshipStage;
  characterInitiative?: "low" | "balanced" | "high";
  characterTopics?: readonly string[];
  teachingOpportunity?: Readonly<{
    skillKey: string;
    preferredStyle?: LearningOpportunity["style"];
  }>;
}>;

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .trim();
}

function hasQuestion(value: string): boolean {
  return value.includes("?") || /^(?:que|qué|como|cómo|donde|dónde|cuando|cuándo|por que|por qué|quien|quién)\b/iu.test(value);
}

function hasTopic(value: string, topics: readonly string[]): boolean {
  return topics.some((topic) => normalized(value).includes(normalized(topic)));
}

function naturalLearningOpportunity(
  input: ReplyPlanningInput,
  blocked: boolean,
): LearningOpportunity | null {
  if (blocked || !input.teachingOpportunity?.skillKey.trim()) return null;
  return {
    skillKey: input.teachingOpportunity.skillKey.trim(),
    style: input.teachingOpportunity.preferredStyle ?? "follow-up",
    reason: "natural-opening",
  };
}

/**
 * Chooses a conversation intention before any surface text is generated.
 * Teaching input can only add a natural opportunity; it never changes the
 * primary intent selected from the user's message.
 */
export function planReply(input: ReplyPlanningInput): ReplyPlan {
  const text = normalized(input.userMessage);
  const relationshipStage = input.relationshipStage ?? "new_contact";
  const initiative = input.characterInitiative ?? "balanced";
  const topics = input.characterTopics ?? [];
  const identityQuestion = /(?:eres|es)\s+(?:una?\s+)?(?:ia|bot|persona real)|inteligencia artificial|eres real/iu.test(text);
  const emotionalDistress = /\b(?:triste|preocupad[oa]|ansios[oa]|cansad[oa]|fatal|mal|problema|dif[ií]cil|queja|casero|alquiler)\b/iu.test(text);
  const greeting = /^(?:hola|hey|buenas|que tal|qué tal|buenos dias|buenos días|buenas tardes)\b/iu.test(text);
  const relevantTopic = hasTopic(text, topics);
  const question = hasQuestion(text);
  const placeRequest = /\b(?:donde|dónde|lugar|sitio|recomiendas|que hacer|qué hacer)\b/iu.test(text);
  const learningOpportunity = naturalLearningOpportunity(input, identityQuestion || emotionalDistress);

  if (identityQuestion) {
    return {
      intent: "identity-disclosure",
      emotion: "honest",
      relationshipStage,
      shouldAskFollowUp: true,
      shouldShareExperience: false,
      shouldSuggestTopic: false,
      shouldSuggestPlace: false,
      shouldChangeTopic: false,
      length: "balanced",
      learningOpportunity: null,
      rationale: "be-transparent-about-identity",
    };
  }

  if (emotionalDistress) {
    return {
      intent: "emotional-support",
      emotion: "supportive",
      relationshipStage,
      shouldAskFollowUp: true,
      shouldShareExperience: false,
      shouldSuggestTopic: false,
      shouldSuggestPlace: false,
      shouldChangeTopic: false,
      length: "balanced",
      learningOpportunity: null,
      rationale: "respond-to-emotion",
    };
  }

  if (greeting) {
    return {
      intent: "greeting",
      emotion: "warm",
      relationshipStage,
      shouldAskFollowUp: true,
      shouldShareExperience: initiative !== "low",
      shouldSuggestTopic: false,
      shouldSuggestPlace: false,
      shouldChangeTopic: false,
      length: "balanced",
      learningOpportunity,
      rationale: "keep-the-door-open",
    };
  }

  if (question) {
    return {
      intent: "answer-and-follow-up",
      emotion: "curious",
      relationshipStage,
      shouldAskFollowUp: true,
      shouldShareExperience: relevantTopic && initiative === "high",
      shouldSuggestTopic: relevantTopic,
      shouldSuggestPlace: placeRequest,
      shouldChangeTopic: false,
      length: relevantTopic ? "expanded" : "balanced",
      learningOpportunity,
      rationale: "answer-directly",
    };
  }

  return {
    intent: "acknowledge-and-explore",
    emotion: "warm",
    relationshipStage,
    shouldAskFollowUp: true,
    shouldShareExperience: initiative !== "low",
    shouldSuggestTopic: relevantTopic,
    shouldSuggestPlace: false,
    shouldChangeTopic: false,
    length: relationshipStage === "new_contact" ? "brief" : "balanced",
    learningOpportunity,
    rationale: relevantTopic ? "continue-shared-topic" : "keep-the-door-open",
  };
}

/**
 * MiniMax sometimes leaks a word from another writing system into an otherwise
 * Spanish reply. An unsolicited fragment like that must never reach the user,
 * so any non-Latin script block fails the language gate.
 *
 * The gate is deliberately script-based rather than language-based: no keyword
 * list catches an arbitrary leaked glyph, but presence of another script is
 * decisive and cheap.
 */
export function containsForeignScript(text: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u.test(text);
}

const responseLanguages = [
  "english", "chinese", "mandarin", "french", "german", "japanese", "korean", "italian", "portuguese",
  "ingles", "chino", "frances", "aleman", "japones", "coreano", "italiano", "portugues",
].join("|");

const languageRequestPatterns: readonly RegExp[] = [
  // An expression verb plus the target language: "responde en inglés".
  new RegExp(
    `\\b(?:translate|explain|answer|respond|reply|speak|write|say|tell|talk|traducir|traduce(?:me)?|explicar|explica(?:me)?|responder|responde(?:me)?|contestar|contesta(?:me)?|escribir|escribe(?:me)?|hablar|habla(?:me)?|decir|dime|dilo)(?:\\s+me)?(?:\\s+back)?\\s+(?:in|en)\\s+(?:${responseLanguages})\\b`,
    "u",
  ),
  // An explicit switch: "cambia a inglés", "switch to English".
  new RegExp(
    `\\b(?:switch|change|cambia|cambiar|pasate|pasemos)\\s+(?:to|al?\\s+)?(?:${responseLanguages}|spanish|espanol)\\b`,
    "u",
  ),
  // An explicit refusal of Spanish: "no me hables en español".
  /\bno\s+(?:me\s+)?(?:hables|respondas|contestes|escribas)\s+en\s+espanol\b/u,
  // Chinese request forms: "用中文回复我", "请用中文解释".
  /(?:用|说|讲|写)\s*(?:中文|汉语|普通话|英文|英语)/u,
];

/**
 * True only when the user explicitly asked to be answered in another language.
 *
 * The provider prompts have always promised "in Spanish unless the user asks for
 * another language", and the Lucia messaging design says the character switches
 * language only on request. Without this check the code-level gate silently
 * broke that promise: a user asking for Chinese was answered with the generic
 * "this reply did not arrive" error on every attempt.
 *
 * Only the current user turn counts. A stale preference is never carried
 * forward, so an unrequested Chinese fragment is still rejected.
 */
export function requestedNonSpanishLanguage(userMessage: string): boolean {
  if (!userMessage.trim()) return false;
  const normalized = userMessage
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/gu, " ")
    .trim();
  // Han characters survive normalization, so the Chinese patterns are matched
  // against the original message while the Latin patterns use the normalized one.
  return languageRequestPatterns.some(
    (pattern) => pattern.test(normalized) || pattern.test(userMessage),
  );
}

