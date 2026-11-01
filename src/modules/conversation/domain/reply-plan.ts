import { requestsActivityAdvice, requestsQuestionRepeat } from "./reply-continuity";

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

/** Explicit current-turn refusal only; quotations and topic-specific limits are not global refusals. */
function explicitlyDeclinesQuestions(userMessage: string): boolean {
  const unquoted = normalized(userMessage).replace(/«[^»]*»|“[^”]*”|"[^"]*"|'[^']*'/gu, "");
  return unquoted.split(/[.!?。！？;；\n]/u).some(clause => {
    if (/\b(?:traduce|traducir|como se dice|que significa)\b|翻译|怎么说|什么意思/u.test(clause)) return false;
    return /^(?:(?:por favor|hoy)[,\s]+)?(?:no me hagas(?: mas)? preguntas|no quiero(?: mas)? preguntas|prefiero que no me preguntes(?: nada)?|no mas preguntas)(?:[,:\s]+(?:por favor|gracias|ahora|hoy|solo escucha(?:me)?))*\s*$/u.test(clause.trim())
      || /^(?:请)?(?:别|不要)再?问我(?:问题|了)[，\s]*(?:谢谢)?\s*$/u.test(clause.trim());
  });
}

export function questionPolicyForReply(input: Readonly<{ userMessage: string }>): QuestionPolicy {
  const text = normalized(input.userMessage);
  if (explicitlyDeclinesQuestions(input.userMessage)) {
    return { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" };
  }
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
  // An explicit request to repeat a question, or help choosing an activity,
  // permits one relevant clarification even though the user used a question
  // mark. Ordinary factual questions still retain the reciprocal-only budget.
  if (requestsQuestionRepeat(input.userMessage) || requestsActivityAdvice(input.userMessage)) {
    return { maxSubstantiveQuestions: 1, allowReciprocalQuestion: true, maxQuestionPressure: "low" };
  }
  // A greeting that also supplies a concrete topic is an opening, not a
  // request to avoid initiative. The old `starts with Hola` shortcut treated
  // "Hola, soy Alex. Me gusta cocinar." like a bare "Hola" and rejected the
  // natural one-question follow-up that the topic invites. Direct questions
  // and explicit boundaries remain handled above this branch.
  if (!text.includes("?") && hasSubstantiveGreetingContent(text)) {
    return { maxSubstantiveQuestions: 1, allowReciprocalQuestion: true, maxQuestionPressure: "low" };
  }
  if (text.includes("?") || /^(?:hola|hey|buenas)\b/iu.test(text)) {
    return { maxSubstantiveQuestions: 0, allowReciprocalQuestion: true, maxQuestionPressure: "low" };
  }
  return { maxSubstantiveQuestions: 1, allowReciprocalQuestion: true, maxQuestionPressure: "low" };
}

function hasSubstantiveGreetingContent(text: string): boolean {
  const remainder = text
    .replace(/^(?:hola|hey|buenas)(?:\s+(?:dias|tardes|noches))?\b[\s,¡!¿?]*/u, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  // A name alone is still a greeting; require at least two content tokens so
  // "Hola, Lucía" keeps the low-pressure greeting policy.
  return remainder.split(/\s+/u).filter(Boolean).length >= 2;
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

/**
 * The user can express attraction while explicitly asking to slow the pace.
 * This is a distinct turn shape: it needs acknowledgement and respect for the
 * boundary, but it must not make Lucía confirm or escalate the relationship.
 */
export function hasPacedAffectionDisclosure(userMessage: string): boolean {
  const text = normalized(userMessage);
  const affection = /\b(?:me gustas|me encantas|creo que me gustas|me estoy enamorando|me he enamorado|me atraes|siento algo por ti)\b/u.test(text);
  const slowerPace = /\b(?:demos? tiempo|dar(?:nos|me) tiempo|con calma|sin prisa|sin prisas|poco a poco|vamos despacio|ir despacio|no (?:quiero|hace falta) apresur|sin poner(?:le)? (?:una )?(?:etiqueta|nombre)|no (?:quiero|hace falta) definir|sin presion)\b/u.test(text);
  return affection && slowerPace;
}

/** Pure semantic gate for a paced-affection response. */
export function acknowledgesPacedAffection(userMessage: string, reply: string): boolean {
  if (!hasPacedAffectionDisclosure(userMessage)) return true;
  const text = normalized(reply);
  const acknowledgement = /\b(?:gracias por (?:decirlo|decirmelo|compartirlo)|me alegra saberlo|me alegra que (?:me lo digas|me gustes)|aprecio que me lo digas|te entiendo|lo entiendo|entiendo lo que (?:sientes|me dices)|me gusta (?:saberlo|que me (?:lo )?digas(?: (?:eso|lo))?|conocerte|hablar contigo)|me hace ilusion saberlo|tu sinceridad|lo que me dices)\b/u.test(text)
    || /\b(?:me gustas|me encantas|tambien me gustas)\b/u.test(text);
  const boundary = /\b(?:con calma|sin prisa|sin prisas|poco a poco|vamos despacio|(?:ir|iremos|avancemos|avanzar) despacio|darnos (?:nuestro )?tiempo|darme tiempo|tomarnos? (?:(?:el|nuestro) )?tiempo(?: que necesitas)?|a (?:tu|nuestro) ritmo|sin (?:poner|tener) (?:una )?(?:etiqueta|nombre)|no (?:hay|hace) falta (?:apresur|definir|decidir)|sin presion)\b/u.test(text);
  const escalates = /\b(?:quieres ser mi pareja|somos pareja|ser(?:emos)? novios|te propongo|confirm(?:ar|emos)? (?:la )?relacion|confirm(?:ar|emos)? (?:lo nuestro)|hacerlo oficial)\b/u.test(text);
  return acknowledgement && boundary && !escalates;
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
