import type { RelationshipStage, QuestionPolicy } from "./reply-plan";
import { containsUnsupportedScript, englishFragment } from "./language-purity";

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
    | "cooldown";
}>;

export const proactiveLimits = {
  maxPer24Hours: 3,
  maxPer7Days: 12,
  minIntervalMs: 4 * 60 * 60 * 1_000,
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

/**
 * Stable, content-free reason why a generated proactive message was rejected.
 * The code is persisted on the candidate and printed by the scheduler so a
 * failure can be diagnosed without logging the message text.
 */
export type ProactiveSafetyViolation =
  | "empty-or-too-long"
  | "markdown"
  | "unsupported-script"
  | "english-fragment"
  | "internal-vocabulary"
  | "banned-cliche"
  | "ai-self-reference"
  | "question-policy"
  | "quiet-too-long"
  | "one-line-too-long";

/** Hard checks for text generated for an already-qualified proactive message. */
export function proactiveMessageSafetyViolation(
  text: string,
  plan: ProactiveReplyPlan,
): ProactiveSafetyViolation | null {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .trim();
  if (!normalized || normalized.length > 480) return "empty-or-too-long";
  if (/[*_`#<>]/u.test(text)) return "markdown";
  // An unsolicited message has no user turn that could justify another
  // language, so it must be pure Spanish. A Spanish sentence carrying a stray
  // "随机" is the reported defect; the provider prompt alone did not prevent it.
  if (containsUnsupportedScript(text)) return "unsupported-script";
  // English shares the Latin script with Spanish, so the check above cannot see
  // it. The reported 2026-10-23 message ("Acabo de Wake Up y foster me he
  // acordado de ti") mixed English words into an otherwise Spanish message.
  if (englishFragment(text)) return "english-fragment";
  if (/\b(?:system prompt|memory permissions|provider details|evidence_events|mastery|confidence|app|usuario|sesion|sesión|eliges|seleccionas)\b/iu.test(normalized)) return "internal-vocabulary";
  if (/\b(?:dejarte una sonrisa(?: pequena)?|solo queria saludarte)\b/iu.test(normalized)) return "banned-cliche";
  if (/\b(?:soy|recuerda que soy)\b.{0,48}\b(?:ia|inteligencia artificial|personaje)\b/iu.test(normalized)) return "ai-self-reference";
  const questionCount = (text.match(/[¿?]/gu) ?? []).length;
  if (questionCount > 2 || (questionCount > 0 && !plan.questionPolicy.allowReciprocalQuestion)) return "question-policy";
  if (plan.interactionMode === "quiet" && normalized.length > 240) return "quiet-too-long";
  if (plan.preferredLength === "one-line" && (text.includes("\n") || text.length > 96)) return "one-line-too-long";
  return null;
}

export function isProactiveMessageSafe(text: string, plan: ProactiveReplyPlan): boolean {
  return proactiveMessageSafetyViolation(text, plan) === null;
}

export function proactiveDedupeKey(input: Readonly<{
  source: ProactiveMessageSource;
  sourceEventId?: string | null;
  calendarDay?: string;
}>): string {
  const event = input.sourceEventId?.trim() || input.calendarDay?.trim() || "rolling";
  return `lucia:${input.source}:${event}`.slice(0, 240);
}
