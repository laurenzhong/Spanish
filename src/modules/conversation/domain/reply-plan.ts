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
