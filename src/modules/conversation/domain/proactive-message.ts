import type { RelationshipStage, QuestionPolicy } from "./reply-plan";
import { containsUnsupportedScript } from "./language-purity";

export const proactiveMessageSources = [
  "spontaneous_affection",
  "memory_callback",
  "follow_up_commitment",
  "daily_share",
  "relationship_milestone",
  "quiet_presence",
] as const;

export type ProactiveMessageSource = (typeof proactiveMessageSources)[number];
export const proactiveDailyStates = ["available", "waking", "having-breakfast", "awake-late"] as const;
export type ProactiveDailyState = (typeof proactiveDailyStates)[number];

export type ProactiveEligibilityState = Readonly<{
  relationshipStatus: "active" | "inactive";
  relationshipStage: RelationshipStage;
  relationshipSummary: string | null;
  proactiveEnabled: boolean;
  lastInteractionAt: Date | null;
  lastProactiveMessageAt: Date | null;
  proactiveCount24h: number;
  proactiveCount7d: number;
  hasUnansweredProactive: boolean;
}>;

export type ProactiveEligibilityDecision = Readonly<{
  allowed: boolean;
  reason:
    | "eligible"
    | "character-disabled"
    | "relationship-inactive"
    | "proactive-paused"
    | "awaiting-first-user-message"
    | "daily-limit"
    | "weekly-limit"
    | "cooldown"
    | "unanswered-message";
}>;

export const proactiveLimits = {
  // Product decision (2026-10-10): several proactive moments a day are intended,
  // so the earlier one-message-a-day ceiling was raised here.
  maxPer24Hours: 3,
  maxPer7Days: 12,
  minIntervalMs: 4 * 60 * 60 * 1_000,
  /**
   * An unanswered proactive message only suppresses sending while it is still
   * recent. A permanent block would silently stop the character from ever
   * reaching out again once the user does not reply to a single message.
   */
  unansweredSuppressionMs: 12 * 60 * 60 * 1_000,
} as const;

/**
 * Server-owned send qualification. A provider never gets to override this
 * decision; it only receives a context after this function returns allowed.
 */
export function evaluateProactiveEligibility(
  state: ProactiveEligibilityState,
  now: Date,
): ProactiveEligibilityDecision {
  if (state.relationshipStatus !== "active") return { allowed: false, reason: "relationship-inactive" };
  if (!state.proactiveEnabled) return { allowed: false, reason: "proactive-paused" };
  // The authored contact opening owns first contact. Wait for an actual user
  // reply before a scheduler can add unsolicited messages to that new thread.
  if (state.lastInteractionAt === null) return { allowed: false, reason: "awaiting-first-user-message" };
  if (
    state.hasUnansweredProactive
    && state.lastProactiveMessageAt
    && now.getTime() - state.lastProactiveMessageAt.getTime() < proactiveLimits.unansweredSuppressionMs
  ) {
    return { allowed: false, reason: "unanswered-message" };
  }
  if (state.proactiveCount24h >= proactiveLimits.maxPer24Hours) return { allowed: false, reason: "daily-limit" };
  if (state.proactiveCount7d >= proactiveLimits.maxPer7Days) return { allowed: false, reason: "weekly-limit" };
  if (state.lastProactiveMessageAt && now.getTime() - state.lastProactiveMessageAt.getTime() < proactiveLimits.minIntervalMs) {
    return { allowed: false, reason: "cooldown" };
  }
  return { allowed: true, reason: "eligible" };
}

export type ProactiveReplyPlan = Readonly<{
  source: ProactiveMessageSource;
  relationshipSignal: "none" | "missing" | "warmth" | "affection";
  interactionMode: "everyday" | "quiet" | "affectionate" | "closing";
  affectionIntensityCeiling: 0 | 1 | 2 | 3;
  questionPolicy: QuestionPolicy;
  preferredLength: "one-line" | "short";
}>;

export function proactiveReplyPlan(
  source: ProactiveMessageSource,
  relationshipStage: RelationshipStage,
  dailyState: ProactiveDailyState = "available",
): ProactiveReplyPlan {
  const mature = relationshipStage === "familiar" || relationshipStage === "close_friend";
  const wakingAffection = source === "spontaneous_affection" && dailyState === "waking" && mature;
  if (source === "relationship_milestone") {
    return {
      source,
      relationshipSignal: "affection",
      interactionMode: "affectionate",
      affectionIntensityCeiling: relationshipStage === "close_friend" ? 3 : 2,
      questionPolicy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" },
      preferredLength: "short",
    };
  }
  if (source === "spontaneous_affection") {
    return {
      source,
      relationshipSignal: mature ? "missing" : "warmth",
      interactionMode: mature ? "affectionate" : "everyday",
      affectionIntensityCeiling: mature ? 2 : 1,
      questionPolicy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" },
      preferredLength: wakingAffection ? "one-line" : "short",
    };
  }
  if (source === "quiet_presence") {
    return {
      source,
      relationshipSignal: "warmth",
      interactionMode: "quiet",
      affectionIntensityCeiling: 1,
      questionPolicy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" },
      preferredLength: "short",
    };
  }
  return {
    source,
    relationshipSignal: source === "daily_share" ? "none" : "warmth",
    interactionMode: "everyday",
    affectionIntensityCeiling: mature ? 2 : 1,
    questionPolicy: source === "daily_share"
      ? { maxSubstantiveQuestions: 1, allowReciprocalQuestion: true, maxQuestionPressure: "low" }
      : { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" },
    preferredLength: "short",
  };
}

/** Hard checks for text generated for an already-qualified proactive message. */
export function isProactiveMessageSafe(text: string, plan: ProactiveReplyPlan): boolean {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .trim();
  if (!normalized || normalized.length > 480) return false;
  if (/[*_`#<>]/u.test(text)) return false;
  // An unsolicited message has no user turn that could justify another
  // language, so it must be pure Spanish. A Spanish sentence carrying a stray
  // Han character is the reported defect; the provider prompt alone did not
  // prevent it. (This replaces main's `containsForeignScript` gate.)
  if (containsUnsupportedScript(text)) return false;
  if (/\b(?:system prompt|memory permissions|provider details|evidence_events|mastery|confidence|app|usuario|sesion|sesión|eliges|seleccionas)\b/iu.test(normalized)) return false;
  if (/\b(?:dejarte una sonrisa(?: pequena)?|solo queria saludarte)\b/iu.test(normalized)) return false;
  if (/\b(?:soy|recuerda que soy)\b.{0,48}\b(?:ia|inteligencia artificial|personaje)\b/iu.test(normalized)) return false;
  const questionCount = (text.match(/[¿?]/gu) ?? []).length;
  if (questionCount > 2 || (questionCount > 0 && !plan.questionPolicy.allowReciprocalQuestion)) return false;
  if (plan.interactionMode === "quiet" && normalized.length > 240) return false;
  if (plan.preferredLength === "one-line" && (text.includes("\n") || text.length > 96)) return false;
  return true;
}

export function proactiveDedupeKey(input: Readonly<{
  source: ProactiveMessageSource;
  sourceEventId?: string | null;
  calendarDay?: string;
}>): string {
  const event = input.sourceEventId?.trim() || input.calendarDay?.trim() || "rolling";
  return `lucia:${input.source}:${event}`.slice(0, 240);
}

export type ProactiveContinuityMessage = Readonly<{
  role: "user" | "character";
  content: string;
}>;

function continuityNormalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES");
}

const continuityStopwords = new Set([
  "para", "como", "cuando", "donde", "porque", "pero", "sino", "sobre", "entre", "desde", "hasta",
  "hacia", "segun", "tambien", "siempre", "nunca", "mucho", "mucha", "muchos", "muchas", "muy",
  "bien", "solo", "algo", "alguno", "alguna", "algunos", "algunas", "este", "esta", "esto",
  "estos", "estas", "ese", "esa", "eso", "esos", "esas", "aquel", "aquella", "otro", "otra",
  "otros", "otras", "tipo", "tipos", "cosa", "cosas", "mas", "menos", "sueles", "suele",
  "suelo", "suelen", "tienes", "tiene", "tener", "haces", "hacer", "hace",
]);

function continuityTokens(value: string): readonly string[] {
  return continuityNormalize(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token.length >= 3 && !continuityStopwords.has(token));
}

function questionFragments(text: string): readonly string[] {
  return text.match(/¿[^?]*\?/gu) ?? [];
}

/** "gente o a paisajes" -> [gente, paisajes]; articles between the options are skipped. */
function disjunctiveQuestionOptions(question: string): readonly (readonly [string, string])[] {
  const normalized = continuityNormalize(question);
  const pattern = /(?:^|\s)([a-z]{3,})\s+o\s+(?:a\s+|al\s+|el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|unos\s+|unas\s+)?([a-z]{3,})(?=[\s,.?!]|$)/gu;
  const options: Array<readonly [string, string]> = [];
  for (const match of normalized.matchAll(pattern)) {
    const left = match[1];
    const right = match[2];
    if (!left || !right || continuityStopwords.has(left) || continuityStopwords.has(right)) continue;
    options.push([left, right]);
  }
  return options;
}

function tokenJaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) if (rightSet.has(token)) intersection += 1;
  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const answeredQuestionMinimumTokens = 4;
const repeatedQuestionSimilarityThreshold = 0.75;

/**
 * A proactive message is unsolicited, so it must not ask for information the
 * conversation already supplied. This is a bounded lexical check, not a general
 * semantic equivalent detector. It catches two reported shapes:
 *
 * 1. A disjunctive preference question whose two options the user already named
 *    in the recent conversation ("me gusta fotografiar gente y paisajes" then
 *    "¿sueles disparar más a gente o a paisajes?").
 * 2. A near-verbatim repeat of a question the character already asked and the
 *    user already answered.
 *
 * Unparseable or short history is not guessed at: no history means no block.
 */
export function repeatsAnsweredQuestion(
  recentMessages: readonly ProactiveContinuityMessage[],
  reply: string,
): boolean {
  const questions = questionFragments(reply);
  if (questions.length === 0) return false;

  const userTokens = new Set(recentMessages
    .filter((message) => message.role === "user")
    .flatMap((message) => continuityTokens(message.content)));
  if (userTokens.size > 0) {
    for (const question of questions) {
      const knownOptions = disjunctiveQuestionOptions(question)
        .some(([left, right]) => userTokens.has(left) && userTokens.has(right));
      if (knownOptions) return true;
    }
  }

  const answeredQuestions: Array<readonly string[]> = [];
  for (let index = 0; index < recentMessages.length; index += 1) {
    const message = recentMessages[index];
    if (!message || message.role !== "character") continue;
    const next = recentMessages[index + 1];
    if (!next || next.role !== "user") continue;
    for (const earlier of questionFragments(message.content)) {
      const tokens = continuityTokens(earlier);
      if (tokens.length >= answeredQuestionMinimumTokens) answeredQuestions.push(tokens);
    }
  }
  if (answeredQuestions.length === 0) return false;
  return questions.some((question) => {
    const tokens = continuityTokens(question);
    return tokens.length >= answeredQuestionMinimumTokens
      && answeredQuestions.some((earlier) => tokenJaccard(earlier, tokens) >= repeatedQuestionSimilarityThreshold);
  });
}
