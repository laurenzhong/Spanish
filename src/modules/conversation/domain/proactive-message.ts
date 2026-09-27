import type { RelationshipStage, QuestionPolicy } from "./reply-plan";

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
